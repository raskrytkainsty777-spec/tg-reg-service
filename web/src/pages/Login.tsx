import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  Alert,
  Button,
  Center,
  Loader,
  PasswordInput,
  SegmentedControl,
  Stack,
  Text,
  TextInput,
} from "@mantine/core";
import { IconAlertTriangle } from "@tabler/icons-react";
import { Navigate, useNavigate, useSearchParams } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";

import { AuthService } from "../api/services/auth.service";
import { errorMessage } from "../helpers/errors";
import { useAuthToken } from "../hooks/useAuthToken";
import { PageTitle, Sticker } from "../components/ui/wa";
import { WA } from "../theme";

type Mode = "password" | "token";

/**
 * Вход: логином и паролем или постоянным токеном доступа.
 * Ссылка /login?token=… входит сама — токен сразу убираем из адреса
 */
export function LoginPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const [token, setToken] = useAuthToken();

  const [mode, setMode] = useState<Mode>("password");
  const [login, setLogin] = useState("");
  const [password, setPassword] = useState("");
  const [accessToken, setAccessToken] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Токен из ссылки — вход без формы. В StrictMode эффект зовётся дважды,
  // поэтому помним, что токен уже взяли
  const urlToken = searchParams.get("token");
  const urlTokenHandled = useRef(false);
  const [autoLogin, setAutoLogin] = useState(!!urlToken);

  const finish = (jwt: string) => {
    queryClient.clear();
    setToken(jwt);
    navigate("/phones", { replace: true });
  };

  useEffect(() => {
    if (!urlToken || urlTokenHandled.current) return;
    urlTokenHandled.current = true;

    // Токен не должен остаться в адресной строке и истории
    const next = new URLSearchParams(searchParams);
    next.delete("token");
    setSearchParams(next, { replace: true });

    setAutoLogin(true);
    AuthService.tokenLogin(urlToken)
      .then((data) => finish(data.token))
      .catch((err) => {
        setMode("token");
        setError(errorMessage(err, "Токен не подошёл"));
      })
      .finally(() => setAutoLogin(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [urlToken]);

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    setLoading(true);

    try {
      const data =
        mode === "password"
          ? await AuthService.login({ login: login.trim(), password })
          : await AuthService.tokenLogin(accessToken.trim());

      finish(data.token);
    } catch (err) {
      setError(
        errorMessage(err, mode === "password" ? "Неверный логин или пароль" : "Токен не подошёл"),
      );
    } finally {
      setLoading(false);
    }
  };

  // Уже вошли — сразу в сервис (если это не вход по новой ссылке)
  if (token && !urlToken && !autoLogin) {
    return <Navigate to="/phones" replace />;
  }

  const canSubmit =
    mode === "password" ? !!login.trim() && !!password : !!accessToken.trim();

  return (
    <Center mih="100dvh" p={16} bg={WA.page}>
      <div
        style={{
          width: "100%",
          maxWidth: 460,
          background: WA.paper,
          border: `3px solid ${WA.ink}`,
          borderRadius: 26,
          padding: "34px 30px",
        }}
      >
        {autoLogin ? (
          <Stack align="center" gap="md" py="xl">
            <Loader />
            <Text c="gray.7">Входим по ссылке…</Text>
          </Stack>
        ) : (
          <form onSubmit={onSubmit}>
            <Stack gap={22}>
              <div style={{ display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap" }}>
                <PageTitle size={48}>Вход</PageTitle>
                <Sticker size={14}>РЕГИСТРАЦИЯ TG</Sticker>
              </div>

              <SegmentedControl
                fullWidth
                value={mode}
                onChange={(value) => {
                  setMode(value as Mode);
                  setError(null);
                }}
                data={[
                  { value: "password", label: "Логин и пароль" },
                  { value: "token", label: "По токену" },
                ]}
              />

              {mode === "password" ? (
                <>
                  <TextInput
                    label="Логин"
                    autoComplete="username"
                    autoFocus
                    value={login}
                    onChange={(event) => setLogin(event.currentTarget.value)}
                  />
                  <PasswordInput
                    label="Пароль"
                    autoComplete="current-password"
                    value={password}
                    onChange={(event) => setPassword(event.currentTarget.value)}
                  />
                </>
              ) : (
                <TextInput
                  label="Токен доступа"
                  description="Есть в Настройках → Вход"
                  autoFocus
                  value={accessToken}
                  onChange={(event) => setAccessToken(event.currentTarget.value)}
                  styles={{ input: { fontFamily: "monospace" } }}
                />
              )}

              {error && (
                <Alert color="red" variant="light" icon={<IconAlertTriangle size={16} />}>
                  {error}
                </Alert>
              )}

              <Button type="submit" color="dark" size="md" loading={loading} disabled={!canSubmit}>
                Войти
              </Button>

              {mode === "password" && (
                <Text size="sm" c="gray.6" ta="center">
                  По умолчанию admin / admin
                </Text>
              )}
            </Stack>
          </form>
        )}
      </div>
    </Center>
  );
}
