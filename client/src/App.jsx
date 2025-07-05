import { BrowserRouter as Router, Routes, Route } from 'react-router-dom'
import Chat from './components/chat'
import Audio from './components/audio'

function App() {
  return (
    <Router>
      <Routes>
        <Route path='/' element={<Audio />} />
        <Route path='/chat' element={<Chat/>} />
      </Routes>
    </Router>
  )
}

export default App