import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { authOptions } from "../lib/authOptions";
import Dashboard from "./Dashboard";

export default async function Home() {
  const session = await getServerSession(authOptions);
  if (!session) redirect("/login");

  return <Dashboard />;
}
