import { auth } from '@/auth'
import { redirect } from 'next/navigation'
import Image from 'next/image'
import type { Metadata } from 'next'
import { SignInButton } from '@/components/SignInButton'

export const metadata: Metadata = { title: 'Sign In' }

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

        <SignInButton />

        <div className="mt-6 text-center">
          <p className="text-sm text-gray-500">
            Access restricted to authorized staff members
          </p>
        </div>
      </div>
    </div>
  )
}