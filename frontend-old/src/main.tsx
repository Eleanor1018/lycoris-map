import React from 'react';
import ReactDOM from 'react-dom/client';
import {BrowserRouter} from 'react-router-dom';
import { CssBaseline, ThemeProvider } from '@mui/material';
import App from "./App.tsx";
import '../src/styles/global.css'
import 'leaflet/dist/leaflet.css'
import axios from 'axios';
import {AuthProvider} from "./auth/AuthProvider.tsx";
import theme from './theme.ts';
import { API_BASE_URL } from './config/runtime'
import { LanguageProvider } from './i18n/LanguageProvider'
axios.defaults.withCredentials = true;
if (API_BASE_URL) {
    axios.defaults.baseURL = API_BASE_URL
}

ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
        <ThemeProvider theme={theme}>
            <CssBaseline />
            <BrowserRouter>
                <LanguageProvider>
                <AuthProvider>
                    <App />
                </AuthProvider>
                </LanguageProvider>
            </BrowserRouter>
        </ThemeProvider>
    </React.StrictMode>
);
