import { signIn, auth } from '@/auth'
import { redirect } from 'next/navigation'
import Image from 'next/image'

export default async function LoginPage() {
  const session = await auth()
  
  // Redirect if already authenticated
  if (session?.user) {
    redirect('/dashboard')
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-900 to-gray-800 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl shadow-2xl p-8 w-full max-w-md">
        <div className="text-center mb-8">
          <div className="bg-lemon-400 w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4">
            <span className="text-2xl font-bold text-gray-900">EL</span>
          </div>
          <h1 className="text-2xl font-bold text-gray-900 mb-2">
            EL Team Portal
          </h1>
          <p className="text-gray-600">
            Sign in to access your case dashboard
          </p>
        </div>

        <form action={async () => {
          "use server"
          await signIn("microsoft-entra-id")
        }}>
          <button
            type="submit"
            className="w-full bg-blue-600 hover:bg-blue-700 text-white font-semibold py-3 px-6 rounded-lg transition-colors duration-200 flex items-center justify-center gap-3"
          >
            <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor">
              <path d="M11.4 24H0V12.6h11.4V24zM24 24H12.6V12.6H24V24zM11.4 11.4H0V0h11.4v11.4zm12.6 0H12.6V0H24v11.4z"/>
            </svg>
            Sign in with Microsoft
          </button>
        </form>

        <div className="mt-6 text-center">
          <p className="text-sm text-gray-500">
            Access restricted to authorized staff members
          </p>
        </div>
      </div>
    </div>
  )
}