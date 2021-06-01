const { expect } = require('chai');
const { ethers } = require('hardhat');
const { deploy, deployMock } = require('../helpers');

const initialTotalL1Supply = 3000;
const depositAmount = 100;

const errorMessages = {
  insufficientAllowance: 'ERC20: transfer amount exceeds allowance',
  insufficientBalance: 'ERC20: transfer amount exceeds balance',
  invalidMessenger: 'OVM_XCHAIN: messenger contract unauthenticated',
  invalidXDomainMessageOriginator: 'OVM_XCHAIN: wrong sender of cross-domain message',
};

describe('L1Gateway', () => {
  describe('deposit()', () => {
    it('sends funds and xchain message on deposit', async () => {
      const [l1MessengerImpersonator, user1] = await ethers.getSigners();
      const { l1TON, l1Gateway, l1CrossDomainMessengerMock, l2GatewayMock } = await setupTest(
        l1MessengerImpersonator,
        user1,
      );

      await l1TON.connect(user1).approve(l1Gateway.address, depositAmount);
      await l1Gateway.connect(user1).deposit(depositAmount);
      const depositCallToMessengerCall = l1CrossDomainMessengerMock.smocked.sendMessage.calls[0];

      expect(await l1TON.balanceOf(user1.address)).to.be.eq(initialTotalL1Supply - depositAmount);
      expect(await l1TON.balanceOf(l1Gateway.address)).to.be.eq(depositAmount);

      expect(depositCallToMessengerCall._target).to.equal(l2GatewayMock.address);
      expect(depositCallToMessengerCall._message).to.equal(
        l2GatewayMock.interface.encodeFunctionData('finalizeDeposit', [user1.address, depositAmount]),
      );
    });

    it('reverts when approval is too low', async () => {
      const [l1MessengerImpersonator, user1] = await ethers.getSigners();
      const { l1TON, l1Gateway } = await setupTest(
        l1MessengerImpersonator,
        user1,
      );

      await l1TON.connect(user1).approve(l1Gateway.address, 0);
      await expect(l1Gateway.connect(user1).deposit(depositAmount)).to.be.revertedWith(
        errorMessages.insufficientAllowance,
      );
    });

    it('reverts when funds too low', async () => {
      const [l1MessengerImpersonator, user1, user2] = await ethers.getSigners();
      const { l1TON, l1Gateway } = await setupTest(
        l1MessengerImpersonator,
        user1,
      );

      await l1TON.connect(user2).approve(l1Gateway.address, depositAmount);
      await expect(l1Gateway.connect(user2).deposit(depositAmount)).to.be.revertedWith(
        errorMessages.insufficientBalance,
      );
    });
  });

  describe('depositTo()', () => {
    it('escrows funds and sends xchain message on deposit', async () => {
      const [l1MessengerImpersonator, user1, user2] = await ethers.getSigners();
      const { l1TON, l1Gateway, l1CrossDomainMessengerMock, l2GatewayMock } = await setupTest(
        l1MessengerImpersonator,
        user1,
      );

      await l1TON.connect(user1).approve(l1Gateway.address, depositAmount);
      await l1Gateway.connect(user1).depositTo(user2.address, depositAmount);
      const depositCallToMessengerCall = l1CrossDomainMessengerMock.smocked.sendMessage.calls[0];

      expect(await l1TON.balanceOf(user1.address)).to.be.eq(initialTotalL1Supply - depositAmount);
      expect(await l1TON.balanceOf(l1Gateway.address)).to.be.eq(depositAmount);

      expect(depositCallToMessengerCall._target).to.equal(l2GatewayMock.address);
      expect(depositCallToMessengerCall._message).to.equal(
        l2GatewayMock.interface.encodeFunctionData('finalizeDeposit', [user2.address, depositAmount]),
      );
    });

    it('reverts when approval is too low', async () => {
      const [l1MessengerImpersonator, user1, user2] = await ethers.getSigners();
      const { l1TON, l1Gateway } = await setupTest(
        l1MessengerImpersonator,
        user1,
      );

      await l1TON.connect(user1).approve(l1Gateway.address, 0);
      await expect(l1Gateway.connect(user1).depositTo(user2.address, depositAmount)).to.be.revertedWith(
        errorMessages.insufficientAllowance,
      );
    });

    it('reverts when funds too low', async () => {
      const [l1MessengerImpersonator, user1, user2] = await ethers.getSigners();
      const { l1TON, l1Gateway } = await setupTest(
        l1MessengerImpersonator,
        user1,
      );

      await l1TON.connect(user2).approve(l1Gateway.address, depositAmount);
      await expect(l1Gateway.connect(user2).depositTo(user1.address, depositAmount)).to.be.revertedWith(
        errorMessages.insufficientBalance,
      );
    });
  });

  describe('finalizeWithdrawal', () => {
    const withdrawAmount = 100;

    it('sends funds from the gateway', async () => {
      const [l1MessengerImpersonator, user1, user2] = await ethers.getSigners();
      const { l1TON, l1Gateway, l1CrossDomainMessengerMock, l2GatewayMock } = await setupWithdrawTest(
        l1MessengerImpersonator,
        user1,
      );
      l1CrossDomainMessengerMock.smocked.xDomainMessageSender.will.return.with(() => l2GatewayMock.address);

      await l1Gateway.connect(l1MessengerImpersonator).finalizeWithdrawal(user2.address, withdrawAmount);

      expect(await l1TON.balanceOf(user2.address)).to.be.equal(withdrawAmount);
      expect(await l1TON.balanceOf(l1Gateway.address)).to.be.equal(initialTotalL1Supply - withdrawAmount);
    });

    it('reverts when called not by XDomainMessenger', async () => {
      const [l1MessengerImpersonator, user1, user2] = await ethers.getSigners();
      const { l1Gateway, l1CrossDomainMessengerMock, l2GatewayMock } = await setupWithdrawTest(
        l1MessengerImpersonator,
        user1,
      );
      l1CrossDomainMessengerMock.smocked.xDomainMessageSender.will.return.with(() => l2GatewayMock.address);

      await expect(l1Gateway.connect(user2).finalizeWithdrawal(user2.address, withdrawAmount)).to.be.revertedWith(
        errorMessages.invalidMessenger,
      );
    });

    it('reverts when called by XDomainMessenger but not relying message from l2Gateway', async () => {
      const [l1MessengerImpersonator, user1, user2, user3] = await ethers.getSigners();
      const { l1Gateway, l1CrossDomainMessengerMock } = await setupWithdrawTest(
        l1MessengerImpersonator,
        user1,
      );
      l1CrossDomainMessengerMock.smocked.xDomainMessageSender.will.return.with(() => user3.address);

      await expect(
        l1Gateway.connect(l1MessengerImpersonator).finalizeWithdrawal(user2.address, withdrawAmount),
      ).to.be.revertedWith(errorMessages.invalidXDomainMessageOriginator);
    });
  });
});

async function setupTest (
  l1MessengerImpersonator,
  user1,
) {
  const l2GatewayMock = await deployMock('L2Gateway');
  const l1CrossDomainMessengerMock = await deployMock(
    'OVM_L1CrossDomainMessenger',
    l1MessengerImpersonator.address,
  );
  const l1TON = await deploy('L1TON', []);
  const l1Gateway = await deploy('L1Gateway', [
    l1TON.address,
    l2GatewayMock.address,
    l1CrossDomainMessengerMock.address,
  ]);
  await l1TON.mint(user1.address, initialTotalL1Supply);

  return { l1TON, l1Gateway, l1CrossDomainMessengerMock, l2GatewayMock };
}

async function setupWithdrawTest (
  l1MessengerImpersonator,
  user1,
) {
  const contracts = await setupTest(l1MessengerImpersonator, user1);
  await contracts.l1TON.connect(user1).transfer(contracts.l1Gateway.address, initialTotalL1Supply);

  return contracts;
}
