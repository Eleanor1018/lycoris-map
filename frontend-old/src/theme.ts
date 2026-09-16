import { createTheme } from '@mui/material/styles'

const fontStack = [
  '"Roboto"',
  '"Noto Sans SC"',
  '"Source Han Sans SC"',
  '"PingFang SC"',
  '"Hiragino Sans GB"',
  '"Microsoft YaHei"',
  '"WenQuanYi Micro Hei"',
  '"Segoe UI"',
  '"Helvetica Neue"',
  'Arial',
  'sans-serif',
].join(', ')

const theme = createTheme({
  palette: {
    primary: {
      main: '#5a3850',
    },
    secondary: {
      main: '#d0bcff',
    },
    background: {
      default: '#f8ebff',
      paper: '#ffffff',
    },
  },
  typography: {
    fontFamily: fontStack,
    h3: {
      fontWeight: 800,
      fontSize: '2.1rem',
      lineHeight: 1.2,
    },
    h4: {
      fontWeight: 800,
      fontSize: '1.9rem',
      lineHeight: 1.25,
    },
    h5: {
      fontWeight: 800,
      fontSize: '1.55rem',
      lineHeight: 1.28,
    },
    h6: {
      fontWeight: 700,
      fontSize: '1.08rem',
      lineHeight: 1.35,
    },
    body1: {
      fontSize: '0.94rem',
      lineHeight: 1.62,
    },
    body2: {
      fontSize: '0.88rem',
      lineHeight: 1.58,
    },
    button: {
      textTransform: 'none',
      fontWeight: 600,
    },
  },
  shape: {
    borderRadius: 12,
  },
  components: {
    MuiCssBaseline: {
      styleOverrides: {
        '*, *::before, *::after': {
          boxSizing: 'border-box',
        },
        html: {
          WebkitFontSmoothing: 'antialiased',
          MozOsxFontSmoothing: 'grayscale',
          textRendering: 'optimizeLegibility',
        },
        body: {
          background:
            'linear-gradient(180deg, #f6f6f6 0%, #f6f6f6 58%, #f8ebff 100%)',
          color: '#1d1b20',
        },
      },
    },
    MuiPaper: {
      styleOverrides: {
        root: {
          borderRadius: 16,
        },
      },
    },
    MuiCard: {
      styleOverrides: {
        root: {
          borderRadius: 16,
          border: '1px solid rgba(122, 75, 143, 0.12)',
          boxShadow: '0 10px 28px rgba(70, 40, 84, 0.08)',
        },
      },
    },
    MuiDialog: {
      styleOverrides: {
        paper: {
          borderRadius: 18,
          boxShadow: '0 18px 46px rgba(70, 40, 84, 0.18)',
        },
      },
    },
    MuiOutlinedInput: {
      styleOverrides: {
        root: {
          borderRadius: 14,
          backgroundColor: 'rgba(255, 255, 255, 0.96)',
          transition: 'border-color 120ms ease, box-shadow 120ms ease',
          '&:hover .MuiOutlinedInput-notchedOutline': {
            borderColor: 'rgba(122, 75, 143, 0.45)',
          },
          '&.Mui-focused .MuiOutlinedInput-notchedOutline': {
            borderColor: '#7a4b8f',
            borderWidth: 1.5,
          },
        },
        input: {
          fontSize: 14,
          lineHeight: 1.4,
          paddingTop: 11,
          paddingBottom: 11,
        },
        inputSizeSmall: {
          paddingTop: 8,
          paddingBottom: 8,
        },
      },
    },
    MuiTextField: {
      defaultProps: {
        size: 'small',
      },
    },
    MuiInputLabel: {
      styleOverrides: {
        root: {
          fontSize: 14,
          color: 'rgba(35, 24, 40, 0.72)',
        },
      },
    },
    MuiButton: {
      styleOverrides: {
        root: {
          borderRadius: 999,
          lineHeight: 1.2,
          letterSpacing: 0,
          minHeight: 36,
          paddingLeft: 16,
          paddingRight: 16,
        },
      },
    },
    MuiChip: {
      styleOverrides: {
        root: {
          borderRadius: 999,
          fontWeight: 600,
        },
      },
    },
  },
})

export default theme
