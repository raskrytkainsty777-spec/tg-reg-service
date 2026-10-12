import axios, { isAxiosError } from "axios";

// API сервиса — на том же домене; VITE_API_URL — если фронт живёт отдельно
const apiInstance = axios.create({
  baseURL: (import.meta.env.VITE_API_URL || "") + "/api",
});

apiInstance.interceptors.request.use((request) => {
  const token = localStorage.getItem("token");
  if (token) {
    request.headers.setAuthorization(`Bearer ${token}`);
  }
  return request;
});

// Ручки входа отвечают 401 на неверный пароль — это не протухший токен,
// ошибку покажет сама форма
const AUTH_URLS = ["/auth/login", "/auth/token-login"];

apiInstance.interceptors.response.use(
  (response) => response,
  (error) => {
    if (
      isAxiosError(error) &&
      error.response?.status === 401 &&
      !AUTH_URLS.some((url) => error.config?.url?.startsWith(url))
    ) {
      localStorage.removeItem("token");
      if (window.location.pathname !== "/login") {
        window.location.replace("/login");
      }
    }
    return Promise.reject(error);
  }
);

export default apiInstance;
