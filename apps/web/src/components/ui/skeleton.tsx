import { cn } from "@/lib/utils";

function Skeleton({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      className={cn(
        "animate-[pulse_2.4s_cubic-bezier(0.4,0,0.6,1)_infinite] rounded-md bg-secondary motion-reduce:animate-none",
        className,
      )}
      {...props}
    />
  );
}

export { Skeleton };
