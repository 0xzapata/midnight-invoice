import { useTheme } from "next-themes";
import { Toaster as Sonner, toast } from "sonner";

type ToasterProps = React.ComponentProps<typeof Sonner>;

const Toaster = ({ ...props }: ToasterProps) => {
  const { theme = "system" } = useTheme();

  return (
    <Sonner
      theme={theme as ToasterProps["theme"]}
      className="toaster group"
      toastOptions={{
        classNames: {
          toast:
            "group toast group-[.toaster]:bg-card group-[.toaster]:text-foreground group-[.toaster]:border-border group-[.toaster]:shadow-lg group-[.toaster]:rounded-lg",
          description: "group-[.toast]:text-muted-foreground",
          actionButton: "group-[.toast]:bg-primary group-[.toast]:text-primary-foreground",
          cancelButton: "group-[.toast]:bg-muted group-[.toast]:text-muted-foreground",
          success: "group-[.toaster]:border-green-500/30 group-[.toaster]:bg-green-500/10 group-[.toaster]:text-green-400",
          error: "group-[.toaster]:border-red-500/30 group-[.toaster]:bg-red-500/10 group-[.toaster]:text-red-400",
          info: "group-[.toaster]:border-blue-500/30 group-[.toaster]:bg-blue-500/10 group-[.toaster]:text-blue-400",
        },
      }}
      {...props}
    />
  );
};

export { Toaster, toast };

