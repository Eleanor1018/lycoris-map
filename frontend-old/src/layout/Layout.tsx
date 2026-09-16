import {Outlet, useLocation} from "react-router-dom";
import NavigationBar from "../components/NavigationBar.tsx";
import { Box } from '@mui/material'


export default function Layout(){
    const location = useLocation()
    const isMapPage = location.pathname.startsWith('/maps')
    const usesWhitePageBackground =
        location.pathname === '/about' || location.pathname.startsWith('/documents')

    return (
        <>
            {usesWhitePageBackground ? (
                <Box
                    aria-hidden="true"
                    sx={{
                        position: 'fixed',
                        inset: 0,
                        zIndex: 0,
                        bgcolor: '#fff',
                        pointerEvents: 'none',
                    }}
                />
            ) : null}
            <NavigationBar></NavigationBar>
            <Box
                component="main"
                sx={{
                    pt: isMapPage ? 0 : 'var(--nav-height, 80px)',
                    minHeight: '100vh',
                    bgcolor: usesWhitePageBackground ? '#fff' : 'transparent',
                    position: usesWhitePageBackground ? 'relative' : 'static',
                    zIndex: usesWhitePageBackground ? 1 : 'auto',
                }}
            >
                <Outlet></Outlet>
            </Box>
        </>
    )
}
