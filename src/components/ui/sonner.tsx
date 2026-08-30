import { Toaster as Sonner } from "sonner";

type ToasterProps = React.ComponentProps<typeof Sonner>;

const Toaster = ({ ...props }: ToasterProps) => {
  return (
    <Sonner
      className="toaster group"
      toastOptions={{
        classNames: {
          toast:
            "group toast bg-card text-foreground border border-border/60 shadow-premium-lg rounded-2xl font-sans mb-16 md:mb-0",
          description: "text-muted-foreground text-xs font-semibold",
          title: "text-sm font-bold",
          actionButton: "bg-primary text-primary-foreground rounded-lg font-bold",
          cancelButton: "bg-muted text-muted-foreground rounded-lg",
        },
      }}
      {...props}
    />
  );
};

export { Toaster };
