import { useState, useCallback, useRef, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import * as tus from "tus-js-client";
import { uploadMedia } from "@/lib/uploads"; // use the existing compressor and simple uploader for images

export type UploadState =
  | "SELECTED"
  | "PREPROCESSING"
  | "UPLOADING"
  | "SAVING"
  | "SAVED"
  | "FAILED"
  | "CANCELLED";

export type UploadJob = {
  id: string;
  file: File;
  previewUrl: string;
  publicUrl?: string;
  progress: number;
  state: UploadState;
  error?: string;
  abortController?: AbortController;
  tusUpload?: tus.Upload;
};

const BUCKET = "product-images";

// Extracted from supabase instance
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

type UseUploaderOptions = {
  concurrency?: number;
  prefix?: string;
  onSuccess?: (job: UploadJob) => Promise<void>; // Optional callback for immediate DB save
};

export function useUploader({ concurrency = 3, prefix = "drafts", onSuccess }: UseUploaderOptions) {
  const [jobs, setJobs] = useState<UploadJob[]>([]);
  const activeCountRef = useRef(0);
  const queueRef = useRef<string[]>([]);
  const jobsRef = useRef<UploadJob[]>([]);

  useEffect(() => {
    jobsRef.current = jobs;
  }, [jobs]);

  const updateJob = useCallback((id: string, updates: Partial<UploadJob>) => {
    setJobs((prev) =>
      prev.map((job) => (job.id === id ? { ...job, ...updates } : job))
    );
  }, []);

  const processNext = useCallback(async () => {
    if (activeCountRef.current >= concurrency || queueRef.current.length === 0) {
      return;
    }

    const jobId = queueRef.current.shift()!;
    activeCountRef.current++;

    const job = jobsRef.current.find((j) => j.id === jobId);
    if (!job || job.state === "CANCELLED") {
      activeCountRef.current--;
      processNext();
      return;
    }

    try {
      const startTime = performance.now();
      updateJob(job.id, { state: "UPLOADING", progress: 0 });

      const isVideo = job.file.type.startsWith("video/");
      const ext = (job.file.name.split(".").pop() ?? "bin").toLowerCase();
      const filename = `${prefix}/${crypto.randomUUID()}.${ext}`;

      let publicUrl = "";

      if (isVideo) {
        // TUS Resumable Upload for Video
        publicUrl = await new Promise<string>((resolve, reject) => {
          const upload = new tus.Upload(job.file, {
            endpoint: `${supabaseUrl}/storage/v1/upload/resumable`,
            retryDelays: [0, 3000, 5000, 10000, 20000],
            headers: {
              Authorization: `Bearer ${supabaseAnonKey}`,
              apikey: supabaseAnonKey,
              "x-upsert": "true",
            },
            uploadDataDuringCreation: true,
            removeFingerprintOnSuccess: true,
            metadata: {
              bucketName: BUCKET,
              objectName: filename,
              contentType: job.file.type,
              cacheControl: "31536000",
            },
            chunkSize: 6 * 1024 * 1024, // 6MB chunks
            onError: (error) => {
              reject(error);
            },
            onProgress: (bytesUploaded, bytesTotal) => {
              const progress = Math.round((bytesUploaded / bytesTotal) * 100);
              updateJob(job.id, { progress });
            },
            onSuccess: () => {
              const { data } = supabase.storage.from(BUCKET).getPublicUrl(filename);
              resolve(data.publicUrl);
            },
          });

          updateJob(job.id, { tusUpload: upload });

          upload.findPreviousUploads().then((previousUploads) => {
            if (previousUploads.length) {
              upload.resumeFromPreviousUpload(previousUploads[0]);
            }
            upload.start();
          });
        });
      } else {
        updateJob(job.id, { state: "PREPROCESSING" });
        // uploadMedia handles compressImage + supabase.upload
        publicUrl = await uploadMedia(job.file, prefix);
        updateJob(job.id, { progress: 100 });
      }
      
      const uploadDuration = performance.now() - startTime;
      console.log(`[Upload Performance] ${job.file.name} uploaded in ${Math.round(uploadDuration)}ms`);

      if (onSuccess) {
        updateJob(job.id, { state: "SAVING", publicUrl });
        const dbSaveStart = performance.now();
        const latestJob = { ...jobsRef.current.find((j) => j.id === job.id)!, publicUrl, progress: 100 };
        await onSuccess(latestJob);
        const dbSaveDuration = performance.now() - dbSaveStart;
        console.log(`[Upload Performance] DB Save for ${job.file.name} completed in ${Math.round(dbSaveDuration)}ms`);
      }

      updateJob(job.id, { state: "SAVED", publicUrl, progress: 100 });
    } catch (err: any) {
      if (err.message === "Aborted") {
        updateJob(job.id, { state: "CANCELLED" });
      } else {
        updateJob(job.id, { state: "FAILED", error: err.message || "Upload failed" });
      }
    } finally {
      activeCountRef.current--;
      processNext();
    }
  }, [concurrency, prefix, onSuccess, updateJob]);

  const addFiles = useCallback(
    (files: File[]) => {
      const newJobs = files.map((file) => ({
        id: crypto.randomUUID(),
        file,
        previewUrl: URL.createObjectURL(file),
        progress: 0,
        state: "SELECTED" as UploadState,
      }));

      setJobs((prev) => [...prev, ...newJobs]);

      for (const job of newJobs) {
        queueRef.current.push(job.id);
      }

      for (let i = 0; i < concurrency; i++) {
        processNext();
      }
    },
    [concurrency, processNext]
  );

  const removeJob = useCallback((id: string) => {
    const job = jobsRef.current.find((j) => j.id === id);
    if (job) {
      if (job.abortController) {
        job.abortController.abort();
      }
      if (job.tusUpload && job.state === "UPLOADING") {
        job.tusUpload.abort();
      }
      URL.revokeObjectURL(job.previewUrl);
    }
    
    queueRef.current = queueRef.current.filter((qid) => qid !== id);
    setJobs((prev) => prev.filter((j) => j.id !== id));
  }, []);

  const retryJob = useCallback(
    (id: string) => {
      const job = jobsRef.current.find((j) => j.id === id);
      if (job && (job.state === "FAILED" || job.state === "CANCELLED")) {
        updateJob(id, { state: "SELECTED", error: undefined, progress: 0 });
        queueRef.current.push(id);
        processNext();
      }
    },
    [processNext, updateJob]
  );

  const reorderJobs = useCallback((fromIndex: number, toIndex: number) => {
    setJobs((prev) => {
      const copy = [...prev];
      const [moved] = copy.splice(fromIndex, 1);
      copy.splice(toIndex, 0, moved);
      return copy;
    });
  }, []);

  const setInitialJobs = useCallback((initialJobs: UploadJob[]) => {
    setJobs(initialJobs);
  }, []);

  useEffect(() => {
    return () => {
      jobsRef.current.forEach((job) => {
        URL.revokeObjectURL(job.previewUrl);
        if (job.tusUpload && job.state === "UPLOADING") job.tusUpload.abort();
      });
    };
  }, []);

  return {
    jobs,
    addFiles,
    removeJob,
    retryJob,
    reorderJobs,
    setInitialJobs,
    isUploading: jobs.some((j) => j.state === "UPLOADING" || j.state === "PREPROCESSING" || j.state === "SAVING"),
  };
}
