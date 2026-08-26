import { X, Ruler } from "lucide-react";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

export function SizeGuideDrawer({
  isOpen,
  onClose,
  ageGroup,
}: {
  isOpen: boolean;
  onClose: () => void;
  ageGroup?: string;
}) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (isOpen) document.body.style.overflow = "hidden";
    else document.body.style.overflow = "";
    return () => {
      document.body.style.overflow = "";
    };
  }, [isOpen]);

  if (!mounted) return null;

  return createPortal(
    <div
      className={`fixed inset-0 z-[110] transition-opacity duration-300 ${isOpen ? "opacity-100 pointer-events-auto" : "opacity-0 pointer-events-none"}`}
    >
      {/* Backdrop */}
      <div
        className={`absolute inset-0 bg-black/40 backdrop-blur-sm transition-opacity duration-300 ${isOpen ? "opacity-100" : "opacity-0"}`}
        onClick={onClose}
      />

      {/* Drawer */}
      <div
        className={`absolute right-0 top-0 bottom-0 w-full max-w-md bg-background shadow-2xl transition-transform duration-500 ease-[cubic-bezier(0.32,0.72,0,1)] flex flex-col ${isOpen ? "translate-x-0" : "translate-x-full"}`}
      >
        <div className="flex items-center justify-between border-b border-border p-5">
          <div className="flex items-center gap-2">
            <Ruler className="size-5 text-primary" />
            <h2 className="font-display text-lg font-bold">Size Guide</h2>
          </div>
          <button
            onClick={onClose}
            className="rounded-full p-2 transition hover:bg-muted text-muted-foreground hover:text-foreground"
          >
            <X className="size-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-8">
          <div>
            <h3 className="font-semibold text-sm mb-3">Measurement Chart (Inches)</h3>
            <div className="overflow-x-auto rounded-xl border border-border">
              <table className="w-full text-sm text-left">
                <thead className="bg-muted text-muted-foreground text-xs uppercase">
                  <tr>
                    <th className="px-4 py-3 font-semibold">Age Group</th>
                    <th className="px-4 py-3 font-semibold">Chest</th>
                    <th className="px-4 py-3 font-semibold">Length</th>
                    <th className="px-4 py-3 font-semibold">Shoulder</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {[
                    { age: "0-3m", c: "18", l: "11", s: "7" },
                    { age: "3-6m", c: "19", l: "12", s: "7.5" },
                    { age: "6-12m", c: "20", l: "13", s: "8" },
                    { age: "1-2y", c: "22", l: "14", s: "9" },
                    { age: "2-3y", c: "23", l: "15", s: "9.5" },
                    { age: "3-4y", c: "24", l: "16", s: "10" },
                  ].map((row) => (
                    <tr
                      key={row.age}
                      className={`transition-colors ${ageGroup === row.age ? "bg-primary/10 font-medium text-primary" : "hover:bg-muted/50"}`}
                    >
                      <td className="px-4 py-3 whitespace-nowrap">{row.age}</td>
                      <td className="px-4 py-3">{row.c}"</td>
                      <td className="px-4 py-3">{row.l}"</td>
                      <td className="px-4 py-3">{row.s}"</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="rounded-2xl bg-amber-50 p-4 border border-amber-100">
            <h4 className="font-semibold text-amber-900 text-sm mb-1">How to Measure</h4>
            <p className="text-amber-800/80 text-xs leading-relaxed">
              For the most accurate fit, measure your child's chest just under the arms. If you're
              between sizes, we recommend sizing up for kids to allow room for growth.
            </p>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
