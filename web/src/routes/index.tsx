import { createBrowserRouter, Navigate } from "react-router-dom";

import { DashboardLayout } from "../layouts/DashboardLayout";
import { LoginPage } from "../pages/Login";
import { PhonesPage } from "../pages/Phones";
import { RegistrationPage } from "../pages/Registration";
import { TrunksPage } from "../pages/Trunks";
import { EmailsPage } from "../pages/Emails";
import { ProxiesPage } from "../pages/Proxies";
import { SettingsPage } from "../pages/Settings";
import { NotFoundPage } from "../pages/NotFound";

export const router = createBrowserRouter([
  {
    path: "/login",
    element: <LoginPage />,
  },
  {
    element: <DashboardLayout />,
    children: [
      { path: "/", element: <Navigate to="/phones" replace /> },
      { path: "/phones", element: <PhonesPage /> },
      { path: "/registration", element: <RegistrationPage /> },
      { path: "/trunks", element: <TrunksPage /> },
      { path: "/emails", element: <EmailsPage /> },
      { path: "/proxies", element: <ProxiesPage /> },
      { path: "/settings", element: <SettingsPage /> },
      { path: "*", element: <NotFoundPage /> },
    ],
  },
]);
