import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import { forwardRef, type ButtonHTMLAttributes } from 'react';
import { cn } from '@/lib/utils';

export const buttonStyles = cva(
  'inline-flex shrink-0 select-none items-center justify-center gap-2 whitespace-nowrap rounded-lg font-medium transition-[background-color,color,box-shadow,opacity] duration-150 ease-out press disabled:pointer-events-none disabled:opacity-40 [&_svg]:size-4 [&_svg]:shrink-0',
  {
    variants: {
      variant: {
        primary: 'bg-accent text-accent-fg hover:bg-accent/90 dark:shadow-[inset_0_1px_0_rgb(255_255_255/0.2)]',
        secondary: 'bg-surface text-fg shadow-card hover:bg-surface-2',
        outline: 'bg-surface text-fg shadow-card hover:bg-surface-2',
        quiet: 'bg-surface-2 text-fg hover:bg-surface-3',
        ghost: 'text-fg-2 hover:bg-surface-2 hover:text-fg',
        danger: 'bg-surface text-bad shadow-card hover:bg-bad/[0.06]',
        link: 'h-auto rounded-md px-0 text-fg-2 hover:text-fg',
      },
      size: {
        sm: 'h-8 px-3 text-sm',
        md: 'h-9 px-4 text-base',
        lg: 'h-11 px-5 text-md',
        xl: 'h-12 px-6 text-md',
        icon: 'size-9',
        'icon-sm': 'size-8',
      },
    },
    defaultVariants: { variant: 'secondary', size: 'md' },
  },
);

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonStyles> {
  asChild?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(({ className, variant, size, asChild, type, ...props }, ref) => {
  const Comp = asChild ? Slot : 'button';
  return <Comp ref={ref} type={asChild ? undefined : type ?? 'button'} className={cn(buttonStyles({ variant, size }), className)} {...props} />;
});
Button.displayName = 'Button';
