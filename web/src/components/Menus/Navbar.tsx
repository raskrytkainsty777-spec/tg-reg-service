import type { CSSProperties, ReactNode } from "react";
import { ActionIcon, Tooltip } from "@mantine/core";
import {
  IconDeviceMobile,
  IconLayoutSidebarLeftCollapse,
  IconLayoutSidebarLeftExpand,
  IconLogout,
  IconMail,
  IconPhoneCall,
  IconPlayerPlay,
  IconSettings,
  IconWorld,
} from "@tabler/icons-react";
import { Link, useLocation } from "react-router-dom";

import { WA } from "../../theme";
import classes from "./Navbar.module.css";

interface NavItemProps {
  title: string;
  href: string;
  icon: ReactNode;
  color: string;
  pathname: string;
  collapsed?: boolean;
}

const isUnder = (pathname: string, href: string) =>
  pathname === href || pathname.startsWith(`${href}/`);

const NavItem = ({ title, href, icon, color, pathname, collapsed }: NavItemProps) => {
  const active = isUnder(pathname, href);

  const item = (
    <Link
      to={href}
      className={classes.item}
      data-active={active || undefined}
      data-collapsed={collapsed || undefined}
      style={{ "--item-color": color, "--item-chip": `${color}22` } as CSSProperties}
      aria-label={collapsed ? title : undefined}
    >
      <span className={classes.chip}>{icon}</span>
      {!collapsed && <span className={classes.title}>{title}</span>}
    </Link>
  );

  if (collapsed) {
    return (
      <Tooltip label={title} position="right" withArrow>
        {item}
      </Tooltip>
    );
  }

  return item;
};

// Разделы сервиса — в порядке работы: телефоны → запуск → ресурсы реги → ключи
const ITEMS = [
  { title: "Телефоны", href: "/phones", icon: <IconDeviceMobile size={16} />, color: WA.orange },
  { title: "Регистрация", href: "/registration", icon: <IconPlayerPlay size={16} />, color: WA.green },
  { title: "Транки", href: "/trunks", icon: <IconPhoneCall size={16} />, color: WA.purple },
  { title: "Почты", href: "/emails", icon: <IconMail size={16} />, color: WA.purple },
  { title: "Прокси", href: "/proxies", icon: <IconWorld size={16} />, color: WA.purple },
  { title: "Настройки", href: "/settings", icon: <IconSettings size={16} />, color: WA.ink },
];

interface NavbarProps {
  collapsed?: boolean;
  onToggle?: () => void;
  onLogout: () => void;
}

/** Текстовый логотип сервиса */
export function BrandLogo({ compact }: { compact?: boolean }) {
  return (
    <Link to="/phones" className={classes.head} aria-label="Регистрация TG">
      <span className={classes.mark}>TG</span>
      {!compact && <span className={classes.brand}>Регистрация TG</span>}
    </Link>
  );
}

export function Navbar({ collapsed = false, onToggle, onLogout }: NavbarProps) {
  const pathname = useLocation().pathname;

  const toggle = onToggle && (
    <Tooltip
      label={collapsed ? "Развернуть меню" : "Свернуть меню"}
      position="right"
      withArrow
    >
      <ActionIcon
        className={classes.toggle}
        variant="subtle"
        color="gray"
        size="sm"
        visibleFrom="sm"
        onClick={onToggle}
        aria-label={collapsed ? "Развернуть меню" : "Свернуть меню"}
      >
        {collapsed ? (
          <IconLayoutSidebarLeftExpand size={18} />
        ) : (
          <IconLayoutSidebarLeftCollapse size={18} />
        )}
      </ActionIcon>
    </Tooltip>
  );

  return (
    <nav className={classes.nav} data-collapsed={collapsed || undefined}>
      <BrandLogo compact={collapsed} />

      <div className={classes.sections}>
        {ITEMS.map((item) => (
          <NavItem key={item.href} {...item} pathname={pathname} collapsed={collapsed} />
        ))}
      </div>

      {/* Выход — внизу, чип без заливки; рядом — свернуть меню */}
      <div className={classes.foot}>
        <Tooltip label="Выйти" position="right" withArrow disabled={!collapsed}>
          <button
            type="button"
            className={classes.item}
            data-collapsed={collapsed || undefined}
            aria-label={collapsed ? "Выйти" : undefined}
            style={{ flex: collapsed ? undefined : 1 }}
            onClick={onLogout}
          >
            <span className={classes.chipOutline}>
              <IconLogout size={16} />
            </span>
            {!collapsed && <span className={classes.title}>Выйти</span>}
          </button>
        </Tooltip>
        {toggle}
      </div>
    </nav>
  );
}
