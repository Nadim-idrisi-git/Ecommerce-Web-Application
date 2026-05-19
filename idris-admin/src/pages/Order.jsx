import React, { useEffect, useMemo, useState } from 'react'
import axios from 'axios'
import { toast } from 'react-toastify'
import { backendUrl } from '../App'

const orderStatuses = [
  'Order Placed',
  'Packing',
  'Shipped',
  'Out for Delivery',
  'Delivered',
  'Cancelled',
]

const getPaymentStatus = (order) => {
  if (order.status === 'Cancelled') {
    if (!order.payment) return 'No payment captured'
    if (order.refundStatus === 'not_required') return 'No online refund needed'
    if (order.refundStatus === 'refunded') return 'Refunded'
    if (order.refundStatus === 'manual_refund_required') return 'Manual refund required'
    if (order.refundStatus === 'refund_failed') return 'Refund failed'
    return 'Refund pending'
  }

  return order.payment ? 'Paid' : order.paymentStatus || 'Pending'
}

const isRevenueOrder = (order) => {
  if (order.status === 'Cancelled') return false
  if (order.refundStatus === 'refunded') return false
  if (order.paymentStatus === 'refunded' || order.paymentStatus === 'refund_processing') return false
  if (order.paymentMethod === 'COD') return true
  return Boolean(order.payment) || order.paymentStatus === 'paid'
}

const getOrderRevenue = (order) => {
  if (!isRevenueOrder(order)) return 0

  const amount = Number(order.amount || 0)
  const refundedAmount = order.refundStatus === 'refunded' ? Number(order.refundAmount || 0) : 0

  return Math.max(0, amount - refundedAmount)
}

const Order = ({ token }) => {
  const [orders, setOrders] = useState([])
  const [loading, setLoading] = useState(true)
  const [selectedOrder, setSelectedOrder] = useState(null)
  const [saving, setSaving] = useState(false)
  const [editData, setEditData] = useState({
    status: 'Order Placed',
    courier: '',
    trackingNumber: '',
    estimatedDelivery: '',
    adminNote: '',
    payment: false,
  })

  const fetchOrders = async () => {
    try {
      setLoading(true)
      const response = await axios.get(backendUrl + '/api/order/list', {
        headers: { token },
      })

      if (response.data.success) {
        setOrders(response.data.orders)
      } else {
        toast.error(response.data.message || 'Failed to load orders')
      }
    } catch (error) {
      toast.error(error.response?.data?.message || error.message)
    } finally {
      setLoading(false)
    }
  }

  const openOrder = (order) => {
    setSelectedOrder(order)
    setEditData({
      status: order.status || 'Order Placed',
      courier: order.courier || '',
      trackingNumber: order.trackingNumber || '',
      estimatedDelivery: order.estimatedDelivery || '',
      adminNote: order.adminNote || '',
      payment: Boolean(order.payment),
    })
  }

  const updateOrder = async (e) => {
    e.preventDefault()

    try {
      setSaving(true)
      const response = await axios.post(
        backendUrl + '/api/order/update',
        {
          orderId: selectedOrder._id,
          ...editData,
        },
        { headers: { token } }
      )

      if (response.data.success) {
        toast.success(response.data.message)
        setOrders((prev) =>
          prev.map((order) =>
            order._id === selectedOrder._id
              ? { ...order, ...response.data.order, user: selectedOrder.user }
              : order
          )
        )
        setSelectedOrder((prev) => ({ ...prev, ...response.data.order }))
      } else {
        toast.error(response.data.message || 'Failed to update order')
      }
    } catch (error) {
      toast.error(error.response?.data?.message || error.message)
    } finally {
      setSaving(false)
    }
  }

  const stats = useMemo(() => {
    const total = orders.length
    const pending = orders.filter((order) => !['Delivered', 'Cancelled'].includes(order.status)).length
    const delivered = orders.filter((order) => order.status === 'Delivered').length
    const revenue = orders.reduce((sum, order) => sum + getOrderRevenue(order), 0)

    return { total, pending, delivered, revenue }
  }, [orders])

  useEffect(() => {
    fetchOrders()
  }, [])

  return (
    <div className='w-full max-w-6xl'>
      <div className='flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-6'>
        <div>
          <p className='text-xl font-medium text-gray-800'>Orders</p>
          <p className='text-sm text-gray-500 mt-1'>Manage customer orders, delivery status, tracking and payment.</p>
        </div>
        <button
          onClick={fetchOrders}
          className='border border-gray-300 px-4 py-2 text-sm hover:bg-gray-100 w-fit'
          type='button'
        >
          Refresh
        </button>
      </div>

      <div className='grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6'>
        <div className='border bg-white px-4 py-3'>
          <p className='text-xs text-gray-500'>Total Orders</p>
          <p className='text-2xl font-medium text-gray-800'>{stats.total}</p>
        </div>
        <div className='border bg-white px-4 py-3'>
          <p className='text-xs text-gray-500'>Active Orders</p>
          <p className='text-2xl font-medium text-gray-800'>{stats.pending}</p>
        </div>
        <div className='border bg-white px-4 py-3'>
          <p className='text-xs text-gray-500'>Delivered</p>
          <p className='text-2xl font-medium text-gray-800'>{stats.delivered}</p>
        </div>
        <div className='border bg-white px-4 py-3'>
          <p className='text-xs text-gray-500'>Revenue</p>
          <p className='text-2xl font-medium text-gray-800'>${stats.revenue}</p>
        </div>
      </div>

      <div className='hidden lg:grid grid-cols-[1.3fr_1.6fr_1fr_1fr_1fr] border bg-gray-100 px-4 py-3 text-sm font-medium'>
        <p>Customer</p>
        <p>Products</p>
        <p>Amount</p>
        <p>Status</p>
        <p>Delivery</p>
      </div>

      {loading ? (
        <div className='border bg-white px-4 py-8 text-center text-gray-500'>Loading orders...</div>
      ) : orders.length === 0 ? (
        <div className='border bg-white px-4 py-8 text-center text-gray-500'>No orders found.</div>
      ) : (
        <div className='flex flex-col'>
          {orders.map((order) => (
            <button
              key={order._id}
              onClick={() => openOrder(order)}
              className='grid grid-cols-1 sm:grid-cols-[1fr_auto] lg:grid-cols-[1.3fr_1.6fr_1fr_1fr_1fr] gap-3 lg:gap-4 border border-t-0 first:border-t bg-white px-4 py-4 text-left hover:bg-gray-50'
              type='button'
            >
              <div>
                <p className='font-medium text-gray-800'>{order.user?.name || order.address?.firstName || 'Customer'}</p>
                <p className='text-xs text-gray-500 mt-1'>{order.user?.email || order.address?.email}</p>
                <p className='text-xs text-gray-500 mt-1'>{new Date(order.date).toLocaleString()}</p>
              </div>

              <div className='min-w-0'>
                <p className='font-medium text-gray-800'>{order.items.length} item{order.items.length > 1 ? 's' : ''}</p>
                <p className='text-xs text-gray-500 mt-1 truncate'>
                  {order.items.map((item) => `${item.name} (${item.size} x${item.quantity})`).join(', ')}
                </p>
              </div>

              <p className='font-medium text-gray-800'>${order.amount}</p>

              <p className={`text-sm font-medium ${
                order.status === 'Delivered' ? 'text-green-600' :
                order.status === 'Cancelled' ? 'text-red-600' :
                'text-gray-800'
              }`}>
                {order.status}
              </p>

              <div>
                <p className='text-sm text-gray-800'>{order.estimatedDelivery || 'Not set'}</p>
                <p className='text-xs text-gray-500 mt-1'>{order.courier || 'No courier'}</p>
              </div>
            </button>
          ))}
        </div>
      )}

      {selectedOrder && (
        <div className='fixed inset-0 z-50 bg-black/40 px-4 py-6 flex items-center justify-center'>
          <div className='bg-white w-full max-w-5xl max-h-[92vh] overflow-y-auto border shadow-lg'>
            <div className='flex items-center justify-between gap-4 border-b px-4 sm:px-6 py-4'>
              <div>
                <p className='text-lg font-medium text-gray-800'>Order Details</p>
                <p className='text-xs text-gray-500 mt-1'>#{selectedOrder._id}</p>
              </div>
              <button
                onClick={() => setSelectedOrder(null)}
                className='w-8 h-8 border border-gray-300 text-lg hover:bg-gray-100'
                type='button'
              >
                x
              </button>
            </div>

            <div className='grid grid-cols-1 lg:grid-cols-[1.4fr_1fr] gap-6 p-4 sm:p-6'>
              <div className='space-y-6'>
                <div>
                  <p className='font-medium text-gray-800 mb-3'>Products</p>
                  <div className='space-y-3'>
                    {selectedOrder.items.map((item, index) => (
                      <div key={`${item.productId}-${item.size}-${index}`} className='flex gap-4 border p-3'>
                        <img className='w-16 h-16 object-cover border' src={item.image} alt='' />
                        <div className='flex-1'>
                          <p className='font-medium text-gray-800'>{item.name}</p>
                          <p className='text-sm text-gray-500 mt-1'>Size: {item.size} | Quantity: {item.quantity}</p>
                          <p className='text-sm text-gray-800 mt-1'>${item.price} each</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                <div className='grid grid-cols-1 sm:grid-cols-2 gap-4'>
                  <div className='border p-4'>
                    <p className='font-medium text-gray-800 mb-2'>Customer</p>
                    <p>{selectedOrder.user?.name || `${selectedOrder.address?.firstName || ''} ${selectedOrder.address?.lastName || ''}`}</p>
                    <p className='text-gray-500 text-sm mt-1'>{selectedOrder.user?.email || selectedOrder.address?.email}</p>
                    <p className='text-gray-500 text-sm mt-1'>{selectedOrder.address?.phone}</p>
                  </div>

                  <div className='border p-4'>
                    <p className='font-medium text-gray-800 mb-2'>Delivery Address</p>
                    {selectedOrder.address?.label && (
                      <p className='text-xs text-gray-500 mb-1'>{selectedOrder.address.label}</p>
                    )}
                    <p>{selectedOrder.address?.street}</p>
                    <p className='text-gray-500 text-sm mt-1'>
                      {selectedOrder.address?.city}, {selectedOrder.address?.state} {selectedOrder.address?.zipcode}
                    </p>
                    <p className='text-gray-500 text-sm mt-1'>{selectedOrder.address?.country}</p>
                  </div>
                </div>

                <div className='border p-4'>
                  <p className='font-medium text-gray-800 mb-3'>Status History</p>
                  {selectedOrder.statusHistory?.length ? (
                    <div className='space-y-3'>
                      {selectedOrder.statusHistory.map((entry, index) => (
                        <div key={index} className='flex gap-3 text-sm'>
                          <p className='w-32 text-gray-500'>{new Date(entry.date).toLocaleDateString()}</p>
                          <div>
                            <p className='font-medium text-gray-800'>{entry.status}</p>
                            {entry.note && <p className='text-gray-500 mt-1'>{entry.note}</p>}
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className='text-sm text-gray-500'>No history yet.</p>
                  )}
                </div>
              </div>

              <form onSubmit={updateOrder} className='border p-4 h-fit space-y-4'>
                <div>
                  <p className='font-medium text-gray-800'>Manage Order</p>
                  <p className='text-sm text-gray-500 mt-1'>Amount: ${selectedOrder.amount} | {selectedOrder.paymentMethod}</p>
                  <p className='text-sm text-gray-500 mt-1'>Payment: {getPaymentStatus(selectedOrder)}</p>
                  {selectedOrder.refundId && (
                    <p className='text-xs text-gray-500 mt-1 break-all'>Refund ID: {selectedOrder.refundId}</p>
                  )}
                </div>

                <div>
                  <p className='mb-2'>Delivery Status</p>
                  <select
                    value={editData.status}
                    onChange={(e) => setEditData((prev) => ({ ...prev, status: e.target.value }))}
                    className='w-full border border-gray-300 px-3 py-2'
                  >
                    {orderStatuses.map((status) => (
                      <option key={status} value={status}>{status}</option>
                    ))}
                  </select>
                </div>

                <div>
                  <p className='mb-2'>Estimated Delivery</p>
                  <input
                    value={editData.estimatedDelivery}
                    onChange={(e) => setEditData((prev) => ({ ...prev, estimatedDelivery: e.target.value }))}
                    className='w-full border border-gray-300 px-3 py-2'
                    type='date'
                  />
                </div>

                <div>
                  <p className='mb-2'>Courier / Delivery Partner</p>
                  <input
                    value={editData.courier}
                    onChange={(e) => setEditData((prev) => ({ ...prev, courier: e.target.value }))}
                    className='w-full border border-gray-300 px-3 py-2'
                    placeholder='BlueDart, Delhivery, FedEx...'
                  />
                </div>

                <div>
                  <p className='mb-2'>Tracking Number</p>
                  <input
                    value={editData.trackingNumber}
                    onChange={(e) => setEditData((prev) => ({ ...prev, trackingNumber: e.target.value }))}
                    className='w-full border border-gray-300 px-3 py-2'
                    placeholder='Tracking ID'
                  />
                </div>

                <div>
                  <p className='mb-2'>Admin Note</p>
                  <textarea
                    value={editData.adminNote}
                    onChange={(e) => setEditData((prev) => ({ ...prev, adminNote: e.target.value }))}
                    className='w-full border border-gray-300 px-3 py-2 min-h-24'
                    placeholder='Delivery instruction or internal note'
                  />
                </div>

                <label className='flex items-center gap-2'>
                  <input
                    checked={editData.payment}
                    onChange={() => setEditData((prev) => ({ ...prev, payment: !prev.payment }))}
                    type='checkbox'
                  />
                  Payment received
                </label>

                <button
                  className='w-full bg-black text-white py-3 text-sm disabled:opacity-60'
                  disabled={saving}
                  type='submit'
                >
                  {saving ? 'Saving...' : 'Save Order'}
                </button>
              </form>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default Order
