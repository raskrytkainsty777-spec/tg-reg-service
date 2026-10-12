import { useLocalStorage } from "@mantine/hooks";

// JWT лежит в localStorage под ключом «token» строкой как есть (без JSON):
// его же читает интерсептор axios
export const useAuthToken = () => {
  const [token, setToken, removeToken] = useLocalStorage<string | null>({
    key: "token",
    defaultValue: null,
    getInitialValueInEffect: false,
    serialize: (value) => value ?? "",
    deserialize: (value) => value || null,
  });

  const set = (value: string | null) => {
    if (value) {
      setToken(value);
    } else {
      removeToken();
    }
  };

  return [token, set] as const;
};
