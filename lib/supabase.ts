import { cookies } from 'next/headers'
import { createServerClient } from '@supabase/ssr'

export async function createSupabaseServer() {
  const cookieStore = await cookies()

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        // ✅ Next 16 cookieStore doesn’t always expose getAll()
        // So we build the array from get() + the known Supabase cookie names.
        getAll() {
          const names = [
            'sb-access-token',
            'sb-refresh-token',
            'sb-auth-token',
            'supabase-auth-token',
          ]

          const found: { name: string; value: string }[] = []

          for (const name of names) {
            const c = cookieStore.get(name)
            if (c?.value) found.push({ name, value: c.value })
          }

          return found
        },

        // ✅ Required by supabase/ssr
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) => {
            cookieStore.set(name, value, options)
          })
        },
      },
    },
  )
}