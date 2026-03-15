// Stripe-style KPI card.
// accent: CSS color string for the bottom bar.
// skeleton: shows loading placeholder when true.

interface KpiCardProps {
  label:    string
  value:    string | number
  accent?:  string    // tailwind bg class like 'bg-primary-500' OR arbitrary hex
  href?:    string    // optional link on the card
  change?:  string    // e.g. '+12% this month'
  positive?: boolean  // true = green change, false = red, undefined = neutral
  skeleton?: boolean
}

export function KpiCard({ label, value, accent = 'bg-primary-500', href, change, positive, skeleton }: KpiCardProps) {
  const inner = (
    <div className="bg-white rounded-xl border border-gray-200 overflow-hidden hover:shadow-md transition-shadow duration-200 group">
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
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">{label}</p>
            {change && (
              <p className={`text-xs mt-1.5 ${
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
      {/* Accent bar */}
      <div className={`h-1 w-full ${skeleton ? 'bg-gray-100' : accent}`} />
    </div>
  )

  if (href) {
    return (
      <a href={href} className="block">
        {inner}
      </a>
    )
  }
  return inner
}
