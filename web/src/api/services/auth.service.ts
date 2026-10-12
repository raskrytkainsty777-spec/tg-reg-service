import apiInstance from "../instance";

// Вход в сервис: логин и пароль (по умолчанию admin / admin) или постоянный
// токен доступа — им удобно открывать сервис ссылкой /login?token=…

export interface AuthMe {
  login: string;
  // Вошли с паролем по умолчанию — просим сменить
  mustChangePassword: boolean;
}

export const AuthService = {
  login: async (payload: { login: string; password: string }) =>
    (await apiInstance.post<{ token: string }>("/auth/login", payload)).data,

  tokenLogin: async (token: string) =>
    (await apiInstance.post<{ token: string }>("/auth/token-login", { token }))
      .data,

  me: async () => (await apiInstance.get<AuthMe>("/auth/me")).data,

  changePassword: async (payload: { current: string; next: string }) =>
    (await apiInstance.post<{ ok?: boolean }>("/auth/password", payload)).data,

  getAccessToken: async () =>
    (await apiInstance.get<{ token: string }>("/auth/access-token")).data,

  regenerateAccessToken: async () =>
    (await apiInstance.post<{ token: string }>("/auth/access-token/regenerate"))
      .data,
};
