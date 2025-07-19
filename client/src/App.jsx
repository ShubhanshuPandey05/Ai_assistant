import { BrowserRouter as Router, Routes, Route } from 'react-router-dom'
import Chat from './components/chat'
import Audio from './components/audio'
import MultiAgent from './components/multi-agent'
function App() {
  return (
    <Router>
      <Routes>
        <Route path='/' element={<Audio />} />
        <Route path='/multi-agent' element={<MultiAgent />} />
        <Route path='/chat' element={<Chat/>} />
      </Routes>
    </Router>
  )
}

export default App