import { useState, useCallback, useRef, useEffect } from "react";
import { uploadMedia } from "@/lib/uploads";

export type UploadState =
  "SELECTED" | "PREPROCESSING" | "UPLOADING" | "SAVING" | "SAVED" | "FAILED" | "CANCELLED";

export type UploadJob = {
  id: string;
  file: File;
  previewUrl: string;
  publicUrl?: string;
  progress: number;
  state: UploadState;
  error?: string;
  abortController?: AbortController;
};

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
    jobsRef.current = jobsRef.current.map((job) => (job.id === id ? { ...job, ...updates } : job));
    setJobs((prev) => prev.map((job) => (job.id === id ? { ...job, ...updates } : job)));
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
      const isVideo = job.file.type.startsWith("video/");
      updateJob(job.id, {
        state: isVideo ? "UPLOADING" : "PREPROCESSING",
        progress: 10,
      });

      // uploadMedia handles MIME checks, sizing, compression (for images), and Supabase Storage upload
      const publicUrl = await uploadMedia(job.file, prefix);
      updateJob(job.id, { progress: 100 });

      const uploadDuration = performance.now() - startTime;
      console.log(
        `[Upload Performance] ${job.file.name} uploaded in ${Math.round(uploadDuration)}ms`,
      );

      if (onSuccess) {
        updateJob(job.id, { state: "SAVING", publicUrl });
        const dbSaveStart = performance.now();
        const latestJob = {
          ...jobsRef.current.find((j) => j.id === job.id)!,
          publicUrl,
          progress: 100,
        };
        await onSuccess(latestJob);
        const dbSaveDuration = performance.now() - dbSaveStart;
        console.log(
          `[Upload Performance] DB Save for ${job.file.name} completed in ${Math.round(dbSaveDuration)}ms`,
        );
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
      const newJobs: UploadJob[] = files.map((file) => ({
        id: crypto.randomUUID(),
        file,
        previewUrl: URL.createObjectURL(file),
        progress: 0,
        state: "SELECTED" as UploadState,
      }));

      jobsRef.current = [...jobsRef.current, ...newJobs];
      setJobs((prev) => [...prev, ...newJobs]);

      for (const job of newJobs) {
        queueRef.current.push(job.id);
      }

      for (let i = 0; i < concurrency; i++) {
        void processNext();
      }
    },
    [concurrency, processNext],
  );

  const removeJob = useCallback((id: string) => {
    const job = jobsRef.current.find((j) => j.id === id);
    if (job) {
      if (job.abortController) {
        job.abortController.abort();
      }
      URL.revokeObjectURL(job.previewUrl);
    }

    queueRef.current = queueRef.current.filter((qid) => qid !== id);
    jobsRef.current = jobsRef.current.filter((j) => j.id !== id);
    setJobs((prev) => prev.filter((j) => j.id !== id));
  }, []);

  const retryJob = useCallback(
    (id: string) => {
      const job = jobsRef.current.find((j) => j.id === id);
      if (job && (job.state === "FAILED" || job.state === "CANCELLED")) {
        updateJob(id, { state: "SELECTED", error: undefined, progress: 0 });
        queueRef.current.push(id);
        void processNext();
      }
    },
    [processNext, updateJob],
  );

  const reorderJobs = useCallback((fromIndex: number, toIndex: number) => {
    setJobs((prev) => {
      const copy = [...prev];
      const [moved] = copy.splice(fromIndex, 1);
      copy.splice(toIndex, 0, moved);
      jobsRef.current = copy;
      return copy;
    });
  }, []);

  const setInitialJobs = useCallback((initialJobs: UploadJob[]) => {
    jobsRef.current = initialJobs;
    setJobs(initialJobs);
  }, []);

  useEffect(() => {
    return () => {
      jobsRef.current.forEach((job) => {
        URL.revokeObjectURL(job.previewUrl);
        if (job.abortController) job.abortController.abort();
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
    isUploading: jobs.some(
      (j) => j.state === "UPLOADING" || j.state === "PREPROCESSING" || j.state === "SAVING",
    ),
  };
}
