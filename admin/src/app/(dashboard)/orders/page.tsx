import Link from "next/link";
import { Badge, EmptyState, Money, PageHeader, Table, Td, Th } from "@/components/ui";
import { formatDateTime, humanize } from "@/lib/format";
import { pageContext } from "@/lib/page";

export const dynamic = "force-dynamic";

export default async function OrdersPage() {
  const { rt, viewer } = await pageContext();
  const orders = await rt.dashboard.listOrders(viewer);
  return (
    <>
      <PageHeader
        title="Orders"
        description="Read-only. Orders recorded in Zarghoon AI. The existing website's checkout and payments are not connected, and this page never changes orders or payments."
      />
      {orders.length === 0 ? (
        <EmptyState title="No orders recorded">Revenue figures stay unavailable until confirmed orders exist. Nothing is estimated.</EmptyState>
      ) : (
        <Table label="Orders">
          <thead>
            <tr>
              <Th>Order</Th>
              <Th>Customer</Th>
              <Th>Status</Th>
              <Th>Payment</Th>
              <Th className="text-right">Total</Th>
              <Th>Date</Th>
            </tr>
          </thead>
          <tbody>
            {orders.map((o) => (
              <tr key={o.id} data-testid="order-row">
                <Td className="font-medium">{o.orderNumber}</Td>
                <Td><Link href={`/customers/${o.customerId}`} className="text-emerald-800 hover:underline">{o.customerName ?? "Customer"}</Link></Td>
                <Td><Badge>{humanize(o.status)}</Badge></Td>
                <Td>{humanize(o.paymentStatus)}</Td>
                <Td className="tabular text-right"><Money amount={o.total} currency={o.currency} /></Td>
                <Td className="text-muted">{formatDateTime(o.createdAt)}</Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </>
  );
}
