import { Box, Typography } from '@mui/material'

export default function Tools() {
    return (
        <Box sx={{ px: { xs: 2, md: 4 }, py: { xs: 3, md: 5 } }}>
            <Typography variant="h6" sx={{ fontWeight: 700, color: '#744988' }}>
                工具模块正在独立开发中
            </Typography>
            <Typography sx={{ mt: 1, opacity: 0.75 }}>
                初版网站暂时隐藏工具入口，后续会以独立 App 形式上线。
            </Typography>
        </Box>
    )
}
