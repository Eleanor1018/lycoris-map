export const adminContainedButtonSx = {
    borderRadius: 999,
    bgcolor: '#f4b3cc',
    color: 'var(--ly-color-ink)',
    border: '1px solid rgba(90, 56, 80, 0.18)',
    fontWeight: 700,
    boxShadow: '0 8px 18px rgba(244, 179, 204, 0.32)',
    '&:hover': {
        bgcolor: '#efa7c5',
        boxShadow: '0 10px 22px rgba(244, 179, 204, 0.38)',
    },
    '&.Mui-disabled': {
        bgcolor: 'rgba(244, 179, 204, 0.45)',
        color: 'rgba(90, 56, 80, 0.42)',
    },
}

export const adminOutlinedButtonSx = {
    borderRadius: 999,
    color: 'var(--ly-color-ink)',
    borderColor: 'rgba(90, 56, 80, 0.28)',
    fontWeight: 700,
    '&:hover': {
        bgcolor: 'rgba(252, 221, 236, 0.36)',
        borderColor: '#f4b3cc',
    },
}

export const adminPaginationSx = {
    '& .MuiPaginationItem-root.Mui-selected': {
        bgcolor: '#f4b3cc',
        color: 'var(--ly-color-ink)',
        fontWeight: 700,
        '&:hover': {
            bgcolor: '#efa7c5',
        },
    },
}
