import { Routes, Route, Link } from 'react-router-dom'
import UnifiedAgent from './components/UnifiedAgent'
import BulkCall from './components/bulkCall'

function App() {
  return (
    <div className="min-h-screen bg-black text-white">
      {/* <nav className="px-4 py-3 border-b border-white/10 flex items-center gap-4">
        <Link className="text-sm text-gray-300 hover:text-white" to="/">Home</Link>
        <Link className="text-sm text-gray-300 hover:text-white" to="/bulk-call">Bulk Call</Link>
      </nav> */}
      <Routes>
        <Route path="/" element={<UnifiedAgent />} />
        <Route path="/bulk-call" element={<BulkCall />} />
      </Routes>
    </div>
  )
}

export default App