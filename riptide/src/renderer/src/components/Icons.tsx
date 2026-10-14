import type { SVGProps } from 'react'

interface IconProps extends Omit<SVGProps<SVGSVGElement>, 'children'> {
  size?: number
}

function Icon({ size = 16, ...props }: IconProps & { children: React.ReactNode }): JSX.Element {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...props}
    >
      {props.children}
    </svg>
  )
}

export const IconPlus = (p: IconProps): JSX.Element => (
  <Icon {...p}>
    <path d="M12 5v14M5 12h14" />
  </Icon>
)

export const IconArrowDown = (p: IconProps): JSX.Element => (
  <Icon {...p}>
    <path d="M12 4v13" />
    <path d="M6.5 11.5 12 17l5.5-5.5" />
    <path d="M5 20h14" />
  </Icon>
)

export const IconPlay = (p: IconProps): JSX.Element => (
  <Icon {...p}>
    <path d="M7 5.5v13l11-6.5-11-6.5Z" />
  </Icon>
)

export const IconPause = (p: IconProps): JSX.Element => (
  <Icon {...p}>
    <path d="M9 5v14M15 5v14" />
  </Icon>
)

export const IconStop = (p: IconProps): JSX.Element => (
  <Icon {...p}>
    <rect x="6" y="6" width="12" height="12" rx="1.5" />
  </Icon>
)

export const IconTrash = (p: IconProps): JSX.Element => (
  <Icon {...p}>
    <path d="M4 7h16" />
    <path d="M9 7V5h6v2" />
    <path d="M6 7l1 12h10l1-12" />
    <path d="M10 11v5M14 11v5" />
  </Icon>
)

export const IconFolder = (p: IconProps): JSX.Element => (
  <Icon {...p}>
    <path d="M3 7.5A1.5 1.5 0 0 1 4.5 6h4l2 2.5h7A1.5 1.5 0 0 1 19 10v7.5A1.5 1.5 0 0 1 17.5 19h-13A1.5 1.5 0 0 1 3 17.5Z" />
  </Icon>
)

export const IconGear = (p: IconProps): JSX.Element => (
  <Icon {...p}>
    <circle cx="12" cy="12" r="3.2" />
    <path d="M12 3.5v2M12 18.5v2M4.9 7.5l1.7 1M17.4 15.5l1.7 1M4.9 16.5l1.7-1M17.4 8.5l1.7-1" />
  </Icon>
)

export const IconSearch = (p: IconProps): JSX.Element => (
  <Icon {...p}>
    <circle cx="11" cy="11" r="6" />
    <path d="m20 20-3.5-3.5" />
  </Icon>
)

export const IconX = (p: IconProps): JSX.Element => (
  <Icon {...p}>
    <path d="M6 6l12 12M18 6 6 18" />
  </Icon>
)

export const IconCheck = (p: IconProps): JSX.Element => (
  <Icon {...p}>
    <path d="m5 12.5 4.5 4.5L19 7.5" />
  </Icon>
)

export const IconAlert = (p: IconProps): JSX.Element => (
  <Icon {...p}>
    <path d="M12 4 3 19h18L12 4Z" />
    <path d="M12 10v4.5M12 17.2v.3" />
  </Icon>
)

export const IconInfo = (p: IconProps): JSX.Element => (
  <Icon {...p}>
    <circle cx="12" cy="12" r="8.5" />
    <path d="M12 11v5.5M12 7.8v.3" />
  </Icon>
)

export const IconRefresh = (p: IconProps): JSX.Element => (
  <Icon {...p}>
    <path d="M19 12a7 7 0 1 1-2.05-4.95" />
    <path d="M19 4v4h-4" />
  </Icon>
)

export const IconMinimize = (p: IconProps): JSX.Element => (
  <Icon {...p}>
    <path d="M5 12h14" />
  </Icon>
)

export const IconMaximize = (p: IconProps): JSX.Element => (
  <Icon {...p}>
    <rect x="5.5" y="5.5" width="13" height="13" rx="2" />
  </Icon>
)

export const IconRestore = (p: IconProps): JSX.Element => (
  <Icon {...p}>
    <rect x="4.5" y="7.5" width="11" height="11" rx="2" />
    <path d="M8.5 7.5V6a1.5 1.5 0 0 1 1.5-1.5h8A1.5 1.5 0 0 1 19.5 6v8a1.5 1.5 0 0 1-1.5 1.5h-1.5" />
  </Icon>
)

export const IconGlobe = (p: IconProps): JSX.Element => (
  <Icon {...p}>
    <circle cx="12" cy="12" r="8.5" />
    <path d="M3.5 12h17M12 3.5c2.2 2.4 3.3 5.3 3.3 8.5S14.2 18.1 12 20.5c-2.2-2.4-3.3-5.3-3.3-8.5S9.8 5.9 12 3.5Z" />
  </Icon>
)

export const IconGauge = (p: IconProps): JSX.Element => (
  <Icon {...p}>
    <path d="M4.5 17a8 8 0 1 1 15 0" />
    <path d="m12 13 3.5-3.5" />
  </Icon>
)

export const IconClock = (p: IconProps): JSX.Element => (
  <Icon {...p}>
    <circle cx="12" cy="12" r="8.5" />
    <path d="M12 7.5V12l3 2" />
  </Icon>
)

export const IconFile = (p: IconProps): JSX.Element => (
  <Icon {...p}>
    <path d="M13 3.5H7A1.5 1.5 0 0 0 5.5 5v14A1.5 1.5 0 0 0 7 20.5h10a1.5 1.5 0 0 0 1.5-1.5V9Z" />
    <path d="M13 3.5V9h5.5" />
  </Icon>
)

export const IconLink = (p: IconProps): JSX.Element => (
  <Icon {...p}>
    <path d="M10 14a3.5 3.5 0 0 0 5 0l3-3a3.5 3.5 0 1 0-5-5l-1 1" />
    <path d="M14 10a3.5 3.5 0 0 0-5 0l-3 3a3.5 3.5 0 1 0 5 5l1-1" />
  </Icon>
)

export const IconExternal = (p: IconProps): JSX.Element => (
  <Icon {...p}>
    <path d="M14 5h5v5" />
    <path d="M19 5l-8 8" />
    <path d="M18 14v4.5A1.5 1.5 0 0 1 16.5 20h-11A1.5 1.5 0 0 1 4 18.5v-11A1.5 1.5 0 0 1 5.5 6H10" />
  </Icon>
)

export const IconChevronDown = (p: IconProps): JSX.Element => (
  <Icon {...p}>
    <path d="m6 9.5 6 6 6-6" />
  </Icon>
)

export const IconZap = (p: IconProps): JSX.Element => (
  <Icon {...p}>
    <path d="M13 3 5.5 13.5H11l-.5 7.5L18 10.5h-5.5L13 3Z" />
  </Icon>
)

export const IconList = (p: IconProps): JSX.Element => (
  <Icon {...p}>
    <path d="M8 6.5h11M8 12h11M8 17.5h11" />
    <path d="M4.5 6.5h.01M4.5 12h.01M4.5 17.5h.01" />
  </Icon>
)

export const IconPulse = (p: IconProps): JSX.Element => (
  <Icon {...p}>
    <path d="M3 12.5h4l2.5-6 4 12 2.5-6H21" />
  </Icon>
)

export const IconArchive = (p: IconProps): JSX.Element => (
  <Icon {...p}>
    <rect x="4" y="4.5" width="16" height="5" rx="1.5" />
    <path d="M5.5 9.5v8A1.5 1.5 0 0 0 7 19h10a1.5 1.5 0 0 0 1.5-1.5v-8" />
    <path d="M10.5 13h3" />
  </Icon>
)

export const IconMusic = (p: IconProps): JSX.Element => (
  <Icon {...p}>
    <path d="M9 18V6.5l10-2v11" />
    <circle cx="6.5" cy="18" r="2.5" />
    <circle cx="16.5" cy="15.5" r="2.5" />
  </Icon>
)

export const IconVideo = (p: IconProps): JSX.Element => (
  <Icon {...p}>
    <rect x="3.5" y="6" width="12" height="12" rx="2" />
    <path d="m15.5 10 5-3v10l-5-3" />
  </Icon>
)

export const IconCode = (p: IconProps): JSX.Element => (
  <Icon {...p}>
    <path d="m8.5 8.5-4 3.5 4 3.5M15.5 8.5l4 3.5-4 3.5M13.5 5.5l-3 13" />
  </Icon>
)

export const IconRadar = (p: IconProps): JSX.Element => (
  <Icon {...p}>
    <path d="M12 12 4.6 6.5" />
    <circle cx="12" cy="12" r="9" />
    <circle cx="12" cy="12" r="5" />
    <circle cx="12" cy="12" r="1.25" />
  </Icon>
)

export const IconSpider = (p: IconProps): JSX.Element => (
  <Icon {...p}>
    <circle cx="12" cy="12" r="3.25" />
    <path d="M12 8.75V5M12 15.25V19M9 10.5 5.5 8.5M9 13.5l-3.5 2M15 10.5l3.5-2M15 13.5l3.5 2" />
    <path d="M4.5 4.5 7 7M19.5 4.5 17 7M4.5 19.5 7 17M19.5 19.5 17 17" />
  </Icon>
)
