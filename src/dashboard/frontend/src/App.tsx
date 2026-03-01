import { useEffect } from "react";
import { useDashboardStore } from "./store";
import { Header } from "./components/Header";
import { SprintTab } from "./components/SprintTab";
import "./index.css";

export default function App() {
  const connect = useDashboardStore((s) => s.connect);

  useEffect(() => {
    connect();
  }, [connect]);

  return (
    <>
      <Header />
      <SprintTab />
    </>
  );
}
