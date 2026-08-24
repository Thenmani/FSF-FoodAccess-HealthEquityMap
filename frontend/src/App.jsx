import { BrowserRouter, Routes, Route } from "react-router-dom";
import Home from "./pages/Home";
import HealthMap from "./pages/HealthMap";

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/map" element={<HealthMap />} />
      </Routes>
    </BrowserRouter>
  );
}
