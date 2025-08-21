import React, { useState } from 'react'
import { FileSpreadsheet, Upload, FileText, Download } from 'lucide-react'

const BulkCall = () => {
  const [csvFile, setCsvFile] = useState(null)
  const [prompt, setPrompt] = useState('')

  const handleFileChange = (e) => {
    const file = e.target.files && e.target.files[0] ? e.target.files[0] : null
    setCsvFile(file)
  }

  const fileSize = (bytes) => {
    if (!bytes && bytes !== 0) return ''
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  }

  return (
    <div className="min-h-screen bg-black text-white px-4 py-6 flex items-start justify-center">
      <div className="w-full max-w-5xl grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="space-y-6">
          {/* CSV Upload */}
          <div className="rounded-2xl border border-white/10 bg-white/5 p-6">
            <div className="flex items-center gap-3 mb-4">
              <div className="rounded-lg p-2 bg-white/10 border border-white/10">
                <FileSpreadsheet className="w-5 h-5" />
              </div>
              <h2 className="text-lg font-semibold">Upload Contacts CSV</h2>
            </div>

            <p className="text-sm text-gray-400 mb-4">
              Upload a CSV file containing contact details. Expected headers: <span className="text-gray-300">name</span>, <span className="text-gray-300">phone</span>, <span className="text-gray-300">email</span> (optional).
            </p>

            {!csvFile ? (
              <label htmlFor="contacts-csv" className="block cursor-pointer rounded-xl border-2 border-dashed border-white/10 bg-black/40 hover:bg-white/5 transition p-6 text-center">
                <div className="flex flex-col items-center gap-2">
                  <Upload className="w-6 h-6 text-gray-300" />
                  <div className="text-sm text-gray-300">Click to select a CSV file</div>
                  <div className="text-xs text-gray-500">.csv up to ~10MB</div>
                </div>
                <input id="contacts-csv" type="file" accept=".csv" onChange={handleFileChange} className="hidden" />
              </label>
            ) : (
              <div className="flex items-center justify-between gap-3 rounded-xl border border-white/10 bg-black/40 p-4">
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium">{csvFile.name}</div>
                  <div className="text-xs text-gray-400">{fileSize(csvFile.size)}</div>
                </div>
                <label htmlFor="contacts-csv" className="shrink-0 px-4 py-2 rounded-lg bg-white text-black hover:bg-gray-300 cursor-pointer text-sm font-semibold">
                  Change
                  <input id="contacts-csv" type="file" accept=".csv" onChange={handleFileChange} className="hidden" />
                </label>
              </div>
            )}
          </div>

          {/* Prompt */}
          <div className="rounded-2xl border border-white/10 bg-white/5 p-6">
            <div className="flex items-center gap-3 mb-4">
              <div className="rounded-lg p-2 bg-white/10 border border-white/10">
                <FileText className="w-5 h-5" />
              </div>
              <h2 className="text-lg font-semibold">Prompt</h2>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">Call Script / System Prompt</label>
              <textarea
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                placeholder="Describe how the agent should conduct the calls..."
                className="w-full text-sm h-40 p-4 bg-black/60 border border-white/10 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <div className="mt-1 text-xs text-gray-500 text-right">{prompt.length} chars</div>
            </div>
          </div>
        </div>

        {/* Output PDF placeholder */}
        <div>
          <div className="rounded-2xl border border-white/10 bg-white/5 p-6 h-full">
            <div className="flex items-center gap-3 mb-4">
              <div className="rounded-lg p-2 bg-white/10 border border-white/10">
                <Download className="w-5 h-5" />
              </div>
              <h2 className="text-lg font-semibold">Output PDF</h2>
            </div>

            <div className="aspect-[4/3] w-full rounded-xl border-2 border-dashed border-white/10 bg-black/40 grid place-items-center text-gray-400">
              <div className="text-center">
                <div className="text-sm">No PDF generated yet</div>
                <div className="text-xs text-gray-500">The report will appear here after all calls complete.</div>
              </div>
            </div>

            <div className="mt-4 flex items-center gap-3">
              <button disabled className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-gray-700 text-gray-300 cursor-not-allowed">
                <Download className="w-4 h-4" />
                Download PDF
              </button>
              <span className="text-xs text-gray-500">UI only — functionality to be wired later.</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

export default BulkCall