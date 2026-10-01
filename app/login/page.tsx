import { Suspense } from 'react';
import { LoginForm } from '@/components/login-form';

export const metadata = { title: 'Sign in · Lanyard' };

export default function LoginPage() {
  return (
    <main className="grid h-dvh place-items-center p-6">
      <Suspense>
        <LoginForm />
      </Suspense>
    </main>
  );
}
