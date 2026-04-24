declare const FinanceDashboard: React.FC<{
  user: { email: string; name: string; avatar: string | null };
  liveData: {
    shopifyMarkets: any;
    shopifyMonthly: any;
    tripleWhale: any;
    loop: any;
    jortt: any;
  };
  connections: Record<string, string>;
}>;
export default FinanceDashboard;
