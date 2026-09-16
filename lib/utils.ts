import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * O template original so checava se as variaveis EXISTEM. O `.env.example` vem
 * com `your-project-url`, que existe mas nao e URL: o cliente do Supabase
 * estoura com "Invalid supabaseUrl" dentro do middleware, antes de qualquer
 * pagina renderizar. Validar o formato aqui mantem o app de pe enquanto o
 * projeto nao esta configurado.
 */
export const hasEnvVars = Boolean(
  /^https?:\/\//.test(process.env.NEXT_PUBLIC_SUPABASE_URL ?? "") &&
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
);
