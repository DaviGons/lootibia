import { redirect } from "next/navigation";

// A raiz e o analisador. A landing do template saiu junto com /protected.
export default function Home() {
  redirect("/hunts");
}
