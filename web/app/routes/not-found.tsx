import { data } from "react-router";

export { RouteError as ErrorBoundary } from "../components/route-error.tsx";

export function loader() {
  throw data("No page lives at this address.", { status: 404 });
}

export const meta = () => [{ title: "Not found | darius" }];

export default function NotFound(): React.ReactNode {
  return null;
}
