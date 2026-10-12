import { useEffect } from "react";
import { AppShell, Burger, Group } from "@mantine/core";
import { useDisclosure, useLocalStorage, useMediaQuery } from "@mantine/hooks";
import { Navigate, Outlet, useLocation, useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";

import { BrandLogo, Navbar } from "../components/Menus/Navbar";
import { DefaultPasswordAlert } from "../components/Layout/DefaultPasswordAlert";
import { useAuthToken } from "../hooks/useAuthToken";
import { WA } from "../theme";

/** Сайдбар 272px с правой границей 3px, контент — отступы 44px 52px (эталон) */
const NAVBAR_WIDTH = 272;
const NAVBAR_COLLAPSED = 76;

export function DashboardLayout() {
  const [opened, { toggle, close }] = useDisclosure();
  const isMobile = useMediaQuery("(max-width: 48em)");
  const pathname = useLocation().pathname;
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [token, setToken] = useAuthToken();

  // Свёрнутое меню (только иконки) запоминаем между сессиями.
  // На мобильных меню и так выезжает поверх контента — там не сворачиваем
  const [navbarCollapsed, setNavbarCollapsed] = useLocalStorage({
    key: "navbar-collapsed",
    defaultValue: false,
  });

  const collapsed = !isMobile && navbarCollapsed;

  // Перешли на другую страницу — мобильное меню закрываем
  useEffect(() => close, [pathname, close]);

  const onLogout = () => {
    setToken(null);
    // Данные прошлой сессии не должны мелькнуть следующему входу
    queryClient.clear();
    navigate("/login", { replace: true });
  };

  if (!token) {
    return <Navigate to="/login" replace />;
  }

  return (
    <AppShell
      header={{ height: isMobile ? 64 : 0 }}
      navbar={{
        width: collapsed ? NAVBAR_COLLAPSED : NAVBAR_WIDTH,
        breakpoint: "sm",
        collapsed: { mobile: !opened },
      }}
      padding={0}
      withBorder={false}
    >
      <AppShell.Header hiddenFrom="sm" style={{ borderBottom: `3px solid ${WA.ink}` }}>
        <Group h="100%" px={16} justify="space-between">
          <BrandLogo />
          <Burger opened={opened} onClick={toggle} size="sm" aria-label="Меню" />
        </Group>
      </AppShell.Header>

      <AppShell.Navbar bg="white" style={{ borderRight: `3px solid ${WA.ink}` }}>
        <Navbar
          collapsed={collapsed}
          onToggle={() => setNavbarCollapsed((current) => !current)}
          onLogout={onLogout}
        />
      </AppShell.Navbar>

      <AppShell.Main>
        <div
          style={{
            padding: isMobile ? "24px 16px 40px" : "44px 52px 60px",
            minWidth: 0,
          }}
        >
          <DefaultPasswordAlert />
          <Outlet />
        </div>
      </AppShell.Main>
    </AppShell>
  );
}
