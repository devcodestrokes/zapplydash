import React from "react";

interface DashboardUser {
  email: string;
  name: string;
  avatar: string | null;
}

interface LiveData {
  shopifyMarkets?: any[] | null;
  shopifyMonthly?: any[] | null;
  shopifyToday?: { markets: any[]; fetchedAt: string } | null;
  tripleWhale?: any[] | null;
  juo?: any[] | null;
  loop?: any[] | null;
  jortt?: { opexByMonth: any[]; opexDetail: Record<string, any>; revenueByMonth: Record<string, number>; live: boolean } | null;
  xero?: Record<string, any> | null;
}

export default function FinanceDashboard(props: {
  user?: DashboardUser | null;
  liveData?: LiveData | null;
  connections?: Record<string, string>;
  syncedAt?: string | null;
  dataIsStale?: boolean;
  hasAnyData?: boolean;
}): React.JSX.Element;
