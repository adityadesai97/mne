import type { SVGProps } from 'react'

/** The AI mark: a cluster of three sharp four-point sparks (one large, two small). Filled with
 *  mitred joins so the points stay crisp at 14-24px; `strokeWidth` only adds a hairline of weight. */
export function AiMark({ size = 18, strokeWidth = 0.75, ...rest }: { size?: number; strokeWidth?: number } & Omit<SVGProps<SVGSVGElement>, 'width' | 'height' | 'strokeWidth'>) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="currentColor"
      stroke="currentColor"
      strokeWidth={Math.min(strokeWidth, 1)}
      strokeLinejoin="miter"
      strokeMiterlimit={10}
      {...rest}
    >
      <path d="M10 6 L11.8 11.7 L17.5 13.5 L11.8 15.3 L10 21 L8.2 15.3 L2.5 13.5 L8.2 11.7 Z" />
      <path d="M19 1.5 L19.9 4.1 L22.5 5 L19.9 5.9 L19 8.5 L18.1 5.9 L15.5 5 L18.1 4.1 Z" />
      <path d="M19.5 16 L20.2 17.8 L22 18.5 L20.2 19.2 L19.5 21 L18.8 19.2 L17 18.5 L18.8 17.8 Z" />
    </svg>
  )
}
