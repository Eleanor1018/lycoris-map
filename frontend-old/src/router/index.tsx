import { createBrowserRouter } from 'react-router-dom';
import Home from '../pages/Home';
import Login from '../pages/Login';
import Register from '../pages/Register';
import Maps from '../pages/Maps';
import Documents from '../pages/Documents';
import Profile from '../pages/Profile';
import Search from '../pages/Search';

export const router = createBrowserRouter([
    { path: '/', element: <Home /> },
    { path: '/maps', element: <Maps />},
    { path: '/documents', element:<Documents/>},
    { path: '/login', element: <Login /> },
    { path: '/register', element: <Register /> },
    { path: '/search', element: <Search /> },
    { path: '/me', element: <Profile /> },
    { path: '/documents', element: <Documents />},
    { path: '/documents/:slug?', element: <Documents />}
]);
