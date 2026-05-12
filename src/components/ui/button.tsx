import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

/**
 * Push button — matches the Figma "push-button" component.
 *
 * Variants:
 *  - primary:     light-blue gradient fill, hovers to orange (#ffa740),
 *                 active to dark orange (#f98700). Default.
 *  - secondary:   white fill, light grey border.
 *  - destructive: red fill, hovers to darker border.
 */
const buttonVariants = cva(
  [
    "inline-flex items-center justify-center whitespace-nowrap rounded-[2px]",
    "font-['Hanken_Grotesk',sans-serif] font-normal leading-[14px]",
    "border-2 transition-[background-color,border-color,box-shadow,color] duration-150 ease-out",
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ds-green-80)] focus-visible:ring-offset-0",
    "disabled:pointer-events-none",
  ].join(" "),
  {
    variants: {
      variant: {
        primary: [
          // background uses two stacked layers (overlay + base) like Figma
          "bg-[linear-gradient(180deg,rgba(255,255,255,0.17)_0%,rgba(255,255,255,0)_100%),linear-gradient(90deg,var(--ds-blue-primary-fill)_0%,var(--ds-blue-primary-fill)_100%)]",
          "border-[var(--ds-blue-primary)] text-[rgba(0,0,0,0.9)]",
          "shadow-[var(--ds-shadow-button)]",
          "hover:bg-[linear-gradient(180deg,rgba(255,255,255,0.17)_0%,rgba(255,255,255,0)_100%),linear-gradient(90deg,var(--ds-orange)_0%,var(--ds-orange)_100%)]",
          "hover:border-[var(--ds-orange)] hover:shadow-[var(--ds-shadow-button-active)]",
          "active:bg-[linear-gradient(180deg,rgba(255,255,255,0.17)_0%,rgba(255,255,255,0)_100%),linear-gradient(90deg,var(--ds-orange-darkest)_0%,var(--ds-orange-darkest)_100%)]",
          "active:border-[var(--ds-orange-darkest)] active:shadow-[var(--ds-shadow-button-active)]",
          "disabled:bg-none disabled:bg-[var(--ds-grey-light-02)] disabled:border-[var(--ds-grey-light-02)]",
          "disabled:text-[var(--ds-text-disabled)] disabled:shadow-[var(--ds-shadow-destructive)]",
        ].join(" "),
        secondary: [
          "bg-white border-[var(--ds-grey-light-02)] text-[rgba(0,0,0,0.9)]",
          "shadow-[var(--ds-shadow-destructive)]",
          "hover:bg-[linear-gradient(180deg,rgba(255,255,255,0.17)_0%,rgba(255,255,255,0)_100%),linear-gradient(90deg,var(--ds-orange)_0%,var(--ds-orange)_100%)]",
          "hover:border-[var(--ds-orange)] hover:shadow-[var(--ds-shadow-button-active)]",
          "active:bg-[linear-gradient(180deg,rgba(255,255,255,0.17)_0%,rgba(255,255,255,0)_100%),linear-gradient(90deg,var(--ds-orange-darkest)_0%,var(--ds-orange-darkest)_100%)]",
          "active:border-[var(--ds-orange-darkest)] active:shadow-[var(--ds-shadow-button-active)]",
          "disabled:bg-none disabled:bg-[var(--ds-grey-light-02)] disabled:border-[var(--ds-grey-light-02)]",
          "disabled:text-[var(--ds-text-disabled)]",
        ].join(" "),
        destructive: [
          "bg-[linear-gradient(180deg,rgba(255,255,255,0.05)_0%,rgba(255,255,255,0)_100%),linear-gradient(90deg,var(--ds-red)_0%,var(--ds-red)_100%)]",
          "border-[var(--ds-red-dark)] text-[var(--ds-grey-light-01)]",
          "shadow-[var(--ds-shadow-destructive)]",
          "hover:border-[rgba(0,0,0,0.9)]",
          "active:bg-[linear-gradient(90deg,rgba(0,0,0,0.25)_0%,rgba(0,0,0,0.25)_100%),linear-gradient(90deg,var(--ds-red)_0%,var(--ds-red)_100%)]",
          "active:border-black",
          "disabled:bg-none disabled:bg-[var(--ds-grey-light-02)] disabled:border-[var(--ds-grey-light-02)]",
          "disabled:text-[var(--ds-text-disabled)]",
        ].join(" "),
      },
      size: {
        default: "px-6 py-[7px] text-[14px]",
        sm: "px-3 py-[5px] text-[12px] leading-[12px]",
        lg: "px-8 py-[12px] text-[18px] leading-[20px]",
      },
    },
    defaultVariants: { variant: "primary", size: "default" },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, type = "button", ...props }, ref) => (
    <button
      ref={ref}
      type={type}
      className={cn(buttonVariants({ variant, size }), className)}
      {...props}
    />
  ),
);
Button.displayName = "Button";

/**
 * Returns the className string the Button component would apply. Use on
 * <Link>/<a> elements that should look like a Button without sacrificing
 * native navigation behaviour.
 */
export function buttonClasses(
  props: VariantProps<typeof buttonVariants> & { className?: string } = {},
) {
  const { variant, size, className } = props;
  return cn(buttonVariants({ variant, size }), className);
}
