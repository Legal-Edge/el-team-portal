// Stripe-style KPI card — matches Easy Lemon referral portal aesthetic.

interface KpiCardProps {
  label:     string
  value:     string | number
  accent?:   string    // Tailwind bg class for the bottom bar
  href?:     string
  change?:   string
  positive?: boolean
  skeleton?: boolean
}

export function KpiCard({ label, value, accent = 'bg-lemon-400', href, change, positive, skeleton }: KpiCardProps) {
  const inner = (
    <div className="bg-white rounded-xl border border-gray-200 overflow-hidden hover:shadow-card-md transition-all duration-150 group cursor-default">
      <div className="px-6 pt-5 pb-4">
        {skeleton ? (
          <>
            <div className="h-8 w-20 bg-gray-100 rounded animate-pulse mb-2" />
            <div className="h-3 w-28 bg-gray-100 rounded animate-pulse" />
          </>
        ) : (
          <>
            <p className="text-3xl font-bold text-gray-900 tabular-nums leading-none mb-1.5">
              {value}
            </p>
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider">{label}</p>
            {change && (
              <p className={`text-xs mt-1.5 font-medium ${
                positive === true  ? 'text-green-600' :
                positive === false ? 'text-red-500'   :
                'text-gray-400'
              }`}>
                {change}
              </p>
            )}
          </>
        )}
      </div>
      {/* Bottom accent bar */}
      <div className={`h-[3px] w-full ${skeleton ? 'bg-gray-100' : accent}`} />
    </div>
  )

  if (href) return <a href={href} className="block">{inner}</a>
  return inner
}
