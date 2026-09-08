// Test-only entry: real pages, router, route guard, services, storage, Axios and
// modals. Deliberately excludes the unrelated public shell, login and sockets.
// This file is outside src and never imported by the shipped frontend entry.
import React from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Routes, Route, Link } from 'react-router-dom';
import { ToastContainer } from 'react-toastify';
import RouteGuard from '../src/auth/RouteGuard';
import { PERMISSIONS } from '../src/auth/accessControl';
import AddPost from '../src/container/system/Post/AddPost';
import ManagePost from '../src/container/system/Post/ManagePost';
import NotePost from '../src/container/system/Post/NotePost';
import 'react-toastify/dist/ReactToastify.css';
import 'react-datepicker/dist/react-datepicker.css';
import './workspace.css';

const user = JSON.parse(localStorage.getItem('userData') || 'null');
const guard = page => <RouteGuard user={user} hasToken={!!localStorage.getItem('token_user')}
    anyPermissions={[PERMISSIONS.MANAGE_POSTS, PERMISSIONS.MODERATE_POSTS]}>{page}</RouteGuard>;
createRoot(document.getElementById('root')).render(<BrowserRouter>
    <nav aria-label="Điều hướng kiểm thử"><Link to="/admin/add-post">Tạo tin kiểm thử</Link>{' | '}
        <Link to="/admin/manage-post">Danh sách kiểm thử</Link></nav>
    <Routes>
        <Route path="/admin/add-post" element={guard(<AddPost />)} />
        <Route path="/admin/edit-post/:id" element={guard(<AddPost />)} />
        <Route path="/admin/manage-post" element={guard(<ManagePost />)} />
        <Route path="/admin/manage-post/:id" element={guard(<ManagePost />)} />
        <Route path="/admin/note/:id" element={guard(<NotePost />)} />
        <Route path="/login" element={<p>Phiên đã kết thúc — trang giữ chỗ kiểm thử, không phải đăng nhập thật.</p>} />
        <Route path="/forbidden" element={<p>Không có quyền truy cập.</p>} />
    </Routes><ToastContainer autoClose={1500} />
</BrowserRouter>);
