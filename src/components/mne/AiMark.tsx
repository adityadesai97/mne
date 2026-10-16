import type { SVGProps } from 'react'

/** The AI mark: a cluster of three filled four-point sparks (one large, two small) with concave
 *  edges and sharp tips. Fill only, no stroke, so the points stay crisp from 12 to 24px. */
export function AiMark({ size = 18, strokeWidth: _strokeWidth, ...rest }: { size?: number; strokeWidth?: number } & Omit<SVGProps<SVGSVGElement>, 'width' | 'height' | 'strokeWidth'>) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" {...rest}>
      <path d="M9.84 5.45Q11.14 10.65 16.34 11.95Q11.14 13.25 9.84 18.45Q8.54 13.25 3.34 11.95Q8.54 10.65 9.84 5.45Z" />
      <path d="M17.4 1.5Q18.06 4.14 20.7 4.8Q18.06 5.46 17.4 8.1Q16.74 5.46 14.1 4.8Q16.74 4.14 17.4 1.5Z" />
      <path d="M17.4 15.8Q18.06 18.44 20.7 19.1Q18.06 19.76 17.4 22.4Q16.74 19.76 14.1 19.1Q16.74 18.44 17.4 15.8Z" />
    </svg>
  )
}
