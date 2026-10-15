import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { PlaidDisconnectDialog } from '../components/PlaidDisconnectDialog'

const assets = [
  { id: 'a1', name: 'IGV Stock' },
  { id: 'a2', name: 'Joint Checking' },
]

function setup(over: Partial<React.ComponentProps<typeof PlaidDisconnectDialog>> = {}) {
  const props = {
    institutionName: 'Chase',
    assets,
    busy: false,
    onUnlink: vi.fn(),
    onDelete: vi.fn(),
    onCancel: vi.fn(),
    ...over,
  }
  render(<PlaidDisconnectDialog {...props} />)
  return props
}

test('offers keeping or deleting the linked assets, listing them first', async () => {
  const user = userEvent.setup()
  const props = setup()
  expect(screen.getByText('IGV Stock')).toBeInTheDocument()
  expect(screen.getByText('Joint Checking')).toBeInTheDocument()

  await user.click(screen.getByRole('button', { name: 'Disconnect and keep my assets' }))
  expect(props.onUnlink).toHaveBeenCalledTimes(1)
  expect(props.onDelete).not.toHaveBeenCalled()

  await user.click(screen.getByRole('button', { name: 'Disconnect and delete 2 linked assets' }))
  expect(props.onDelete).toHaveBeenCalledTimes(1)
})

test('with nothing linked there is no delete option', () => {
  setup({ assets: [] })
  expect(screen.getByRole('button', { name: 'Disconnect' })).toBeInTheDocument()
  expect(screen.queryByText(/delete/i)).toBeNull()
})

test('shows a loading state with no actions until linked assets are known', () => {
  setup({ assets: null })
  expect(screen.getByText(/checking linked assets/i)).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: /disconnect/i })).toBeNull()
})

test('cancel does nothing destructive', async () => {
  const user = userEvent.setup()
  const props = setup()
  await user.click(screen.getByRole('button', { name: 'Cancel' }))
  expect(props.onCancel).toHaveBeenCalled()
  expect(props.onUnlink).not.toHaveBeenCalled()
  expect(props.onDelete).not.toHaveBeenCalled()
})
