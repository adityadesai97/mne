import type { SVGProps } from 'react'

/** The assistant mark: a ringed orb with a four-point spark. Stroked like the lucide icons around it
 *  (24px grid, round caps) so it sits in the pill, the nav action, the panel header and the chips. */
export function AiMark({ size = 18, strokeWidth = 1.5, ...rest }: { size?: number; strokeWidth?: number } & Omit<SVGProps<SVGSVGElement>, 'width' | 'height' | 'strokeWidth'>) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      {...rest}
    >
      <circle cx="12" cy="12" r="9.5" />
      <path d="M12 7 Q12.9 11.1 17 12 Q12.9 12.9 12 17 Q11.1 12.9 7 12 Q11.1 11.1 12 7 Z" fill="currentColor" />
    </svg>
  )
}
