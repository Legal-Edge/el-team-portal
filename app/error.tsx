'use client'

import { useEffect } from 'react'

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    console.error('[GlobalError]', error)
  }, [error])

  return (
    <html lang="en">
      <body className="flex items-center justify-center min-h-screen bg-gray-50 p-6">
        <div className="max-w-sm w-full text-center space-y-4">
          <p className="text-4xl">⚠️</p>
          <h1 className="text-lg font-semibold text-gray-800">Something went wrong</h1>
          <p className="text-sm text-gray-500 break-words">{error.message}</p>
          {error.digest && <p className="text-xs text-gray-300">ID: {error.digest}</p>}
          <button
            onClick={reset}
            className="mt-4 px-6 py-2.5 bg-gray-900 text-white text-sm rounded-xl hover:bg-gray-700 active:scale-95 transition-all"
          >
            Try again
          </button>
        </div>
      </body>
    </html>
  )
}
