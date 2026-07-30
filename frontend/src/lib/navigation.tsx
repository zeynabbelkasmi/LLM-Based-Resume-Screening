import type { AnchorHTMLAttributes, MouseEvent, ReactNode } from 'react'
import { useLocation as useWouterLocation } from 'wouter'

type LinkProps = Omit<AnchorHTMLAttributes<HTMLAnchorElement>, 'href'> & { to: string; children: ReactNode }

export function Link({ to, children, onClick, ...props }: LinkProps) {
  const [, navigate] = useWouterLocation()
  const handleClick = (event: MouseEvent<HTMLAnchorElement>) => {
    onClick?.(event)
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
    event.preventDefault()
    navigate(to)
  }
  return <a href={to} onClick={handleClick} {...props}>{children}</a>
}

type NavLinkProps = Omit<LinkProps, 'className'> & {
  end?: boolean
  className?: string | ((state: { isActive: boolean }) => string)
}

export function NavLink({ to, end, className, ...props }: NavLinkProps) {
  const [location] = useWouterLocation()
  const pathname = location.split('?')[0]
  const isActive = end ? pathname === to : pathname === to || pathname.startsWith(`${to}/`)
  const resolvedClassName = typeof className === 'function' ? className({ isActive }) : className
  return <Link to={to} className={resolvedClassName} {...props} />
}

export function useLocation() {
  const [location] = useWouterLocation()
  return { pathname: location.split('?')[0] }
}

export function useNavigate() {
  const [, navigate] = useWouterLocation()
  return navigate
}

export function useParams() {
  const [location] = useWouterLocation()
  const match = location.split('?')[0].match(/^\/candidats\/([^/]+)$/)
  return { candidateId: match ? decodeURIComponent(match[1]) : undefined }
}

export function useSearchParams() {
  useWouterLocation()
  return [new URLSearchParams(window.location.search)] as const
}
