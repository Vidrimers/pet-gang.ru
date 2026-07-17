import { Routes, Route } from 'react-router-dom';
import PetGangAdmin from './pages/PetGang/PetGangAdmin';
import PetGangProfile from './pages/PetGang/PetGangProfile';
import PetGangPet from './pages/PetGang/PetGangPet';
import PetGangScan from './pages/PetGang/PetGangScan';

function App() {
  return (
    <Routes>
      <Route path="/" element={<PetGangAdmin />} />
      <Route path="/profile" element={<PetGangProfile />} />
      <Route path="/pet/:id" element={<PetGangPet />} />
      <Route path="/scan/:token" element={<PetGangScan />} />
    </Routes>
  );
}

export default App;
