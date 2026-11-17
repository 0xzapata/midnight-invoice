import { useTheme } from "next-themes";
import { Toaster as Sonner } from "sonner";

type ToasterProps = React.ComponentProps<typeof Sonner>;

const Toaster = ({ ...props }: ToasterProps) => {
  const { theme = "system" } = useTheme();

  return (
    <Sonner
      theme={theme as ToasterProps["theme"]}
      className="toaster group"
      // Sonner injects unlayered CSS, which outranks Tailwind v4's cascade
      // layers, so these overrides are marked important (`!`). Status toasts tint
      // an opaque card background, so page text never shows through them.
      toastOptions={{
        classNames: {
          toast:
            "group toast group-[.toaster]:bg-card! group-[.toaster]:text-foreground! group-[.toaster]:border-border! group-[.toaster]:shadow-lg! group-[.toaster]:rounded-lg!",
          description: "group-[.toast]:text-muted-foreground!",
          actionButton: "group-[.toast]:bg-primary! group-[.toast]:text-primary-foreground!",
          cancelButton: "group-[.toast]:bg-muted! group-[.toast]:text-muted-foreground!",
          success: "group-[.toaster]:border-green-500/30! group-[.toaster]:[background:linear-gradient(rgb(34_197_94/0.1),rgb(34_197_94/0.1)),hsl(var(--card))]! group-[.toaster]:text-green-600! dark:group-[.toaster]:text-green-400!",
          error: "group-[.toaster]:border-red-500/30! group-[.toaster]:[background:linear-gradient(rgb(239_68_68/0.1),rgb(239_68_68/0.1)),hsl(var(--card))]! group-[.toaster]:text-red-600! dark:group-[.toaster]:text-red-400!",
          warning: "group-[.toaster]:border-amber-500/30! group-[.toaster]:[background:linear-gradient(rgb(245_158_11/0.1),rgb(245_158_11/0.1)),hsl(var(--card))]! group-[.toaster]:text-amber-700! dark:group-[.toaster]:text-amber-400!",
          info: "group-[.toaster]:border-blue-500/30! group-[.toaster]:[background:linear-gradient(rgb(59_130_246/0.1),rgb(59_130_246/0.1)),hsl(var(--card))]! group-[.toaster]:text-blue-600! dark:group-[.toaster]:text-blue-400!",
        },
      }}
      {...props}
    />
  );
};

export { Toaster };

