import type { FormEvent, ReactNode } from 'react'
import { Box, Stack, Typography } from '@mui/material'

const authPinPath =
    'M319 562C333.025 562 345.031 556.987 355.019 546.96C365.006 536.933 370 524.88 370 510.8C370 496.72 365.006 484.667 355.019 474.64C345.031 464.613 333.025 459.6 319 459.6C304.975 459.6 292.969 464.613 282.981 474.64C272.994 484.667 268 496.72 268 510.8C268 524.88 272.994 536.933 282.981 546.96C292.969 556.987 304.975 562 319 562ZM319 750.16C370.85 702.373 409.313 658.96 434.388 619.92C459.463 580.88 472 546.213 472 515.92C472 469.413 457.231 431.333 427.694 401.68C398.156 372.027 361.925 357.2 319 357.2C276.075 357.2 239.844 372.027 210.306 401.68C180.769 431.333 166 469.413 166 515.92C166 546.213 178.538 580.88 203.613 619.92C228.688 658.96 267.15 702.373 319 750.16ZM319 818C250.575 759.547 199.469 705.253 165.681 655.12C131.894 604.987 115 558.587 115 515.92C115 451.92 135.506 400.933 176.519 362.96C217.531 324.987 265.025 306 319 306C372.975 306 420.469 324.987 461.481 362.96C502.494 400.933 523 451.92 523 515.92C523 558.587 506.106 604.987 472.319 655.12C438.531 705.253 387.425 759.547 319 818Z'

type AuthPageShellProps = {
    title: string
    children: ReactNode
    footer: ReactNode
    onSubmit: (event: FormEvent<HTMLFormElement>) => void
    maxWidth?: number
}

export default function AuthPageShell({
    title,
    children,
    footer,
    onSubmit,
    maxWidth = 520,
}: AuthPageShellProps) {
    return (
        <Box
            component="section"
            sx={{
                position: 'relative',
                overflow: 'hidden',
                minHeight: 'calc(100svh - var(--nav-height, 94px))',
                px: { xs: 2, md: 'clamp(40px, 5vw, 72px)' },
                py: { xs: 4, md: 6 },
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                background: 'linear-gradient(180deg, #f6f6f6 0%, #f6f6f6 52%, #f8ebff 100%)',
            }}
        >
            <Box
                component="svg"
                viewBox="0 0 402 874"
                preserveAspectRatio="xMidYMid slice"
                aria-hidden="true"
                sx={{
                    position: 'absolute',
                    right: { xs: '-68%', md: '-8%' },
                    bottom: { xs: '-24%', md: '-28%' },
                    width: { xs: '134%', md: '54%' },
                    height: { xs: '88%', md: '116%' },
                    color: 'var(--ly-color-pin)',
                    pointerEvents: 'none',
                }}
            >
                <path d={authPinPath} fill="currentColor" fillOpacity="0.2" />
            </Box>

            <Box
                sx={{
                    position: 'relative',
                    zIndex: 1,
                    width: '100%',
                    maxWidth,
                    mx: 'auto',
                }}
            >
                <Stack
                    component="form"
                    onSubmit={onSubmit}
                    spacing={{ xs: 2.6, md: 2.8 }}
                    sx={{
                        width: '100%',
                        maxWidth,
                        p: { xs: 3.5, md: 5 },
                        borderRadius: '21px',
                        border: '2px solid rgba(221, 165, 196, 0.31)',
                        bgcolor: 'rgba(255, 255, 255, 0.74)',
                        boxShadow: '0 24px 70px rgba(90, 56, 80, 0.12)',
                        backdropFilter: 'blur(22px)',
                        WebkitBackdropFilter: 'blur(22px)',
                    }}
                >
                    <Box>
                        <Typography
                            component="h1"
                            sx={{
                                m: 0,
                                fontFamily: 'var(--ly-font-logo)',
                                fontSize: { xs: 32, md: 36 },
                                fontWeight: 700,
                                lineHeight: 1,
                                letterSpacing: '-0.035em',
                                color: '#000',
                                textAlign: 'center',
                            }}
                        >
                            {title}
                        </Typography>
                    </Box>

                    {children}

                    {footer}
                </Stack>
            </Box>
        </Box>
    )
}
