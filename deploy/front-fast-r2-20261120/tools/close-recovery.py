#!/usr/bin/env python3
"""Certify ORIGINAL restored baseline, then close only its exact failed window.
No active business writes, reloads, old/new apply, repairs, environment replacement,
or claims that requested feature release succeeded. Failure receipts override terminal.
"""
import argparse
import copy
import sys
from pathlib import Path
import certify as q
import release as c
h=c.h
NEW_STAGE=Path('/opt/ops/front-fast-r2-20261120-qp4e5jVm')
RECOVERY=NEW_STAGE/'recovery'
OWNER='qp4e5jVmsAp0UHKwymyD5X'

def close_cas(cfg,before,before_record,closed,terminal_path,terminal_bytes,terminal_record):
    """Only own on_replace record authorizes inverse CAS on late failures."""
    owned={}
    def remember(record):owned['closed']=record
    try:
        h.atomic_cas(cfg.coord,before,closed,NEW_STAGE,on_replace=remember,expected_record=before_record)
        h.need('closed' in owned and h.regular(cfg.coord)==closed and h.describe(cfg.coord)==owned['closed'],'CLOSURE_FULL_READBACK_FAILED')
        c.R.Controller.coord_closed(None,closed)
        h.need(h.regular(terminal_path)==terminal_bytes and h.describe(terminal_path)==terminal_record,'CLOSURE_TERMINAL_READBACK_FAILED')
        h.check_lock_inodes()
    except BaseException as exc:
        failure={'schema':'front-fast-recovery-close-failure-v1','status':'failure-overrides-confirmed','errorType':type(exc).__name__,'closedOwnedRecordObserved':'closed' in owned,'beforeCoordSha256':h.H(before),'intendedClosedCoordSha256':h.H(closed),'operatorHoldRequired':True}
        try:h.exclusive(RECOVERY/'failure.json',h.encode(failure),0o600)
        except BaseException:pass  # Still inverse own close; never interpret terminal alone as success.
        confirmed=False
        if 'closed' in owned:
            try:
                if h.regular(cfg.coord)==closed and h.describe(cfg.coord)==owned['closed']:
                    restored={}
                    h.atomic_cas(cfg.coord,closed,before,NEW_STAGE,on_replace=lambda rec:restored.update(record=rec),expected_record=owned['closed'])
                    confirmed=h.regular(cfg.coord)==before and h.describe(cfg.coord)==restored.get('record')
            except BaseException:
                # A second fsync failure may still leave exact original hold. No foreign overwrite.
                try:confirmed=h.regular(cfg.coord)==before
                except BaseException:confirmed=False
        else:
            try:confirmed=h.regular(cfg.coord)==before and h.describe(cfg.coord)==before_record
            except BaseException:confirmed=False
        try:h.exclusive(RECOVERY/'failure-confirmed.json',h.encode(dict(failure,holdBytesConfirmed=confirmed,ownershipUnconfirmed=not confirmed)),0o600)
        except BaseException:pass
        raise h.ReleaseError('RECOVERY_CLOSE_FAILED_HOLD_CONFIRMED' if confirmed else 'RECOVERY_CLOSE_FAILED_OWNERSHIP_UNCONFIRMED') from exc

def main():
    parser=argparse.ArgumentParser(description=__doc__)
    for arg in ['wrapper-sha256','certifier-sha256','coord-sha256','coord-record-sha256']:parser.add_argument('--'+arg,required=True)
    a=parser.parse_args()
    wrapper_path=Path(__file__).absolute();wrapper=h.regular(wrapper_path)
    h.need(h.H(wrapper)==h.pin(a.wrapper_sha256),'CLOSURE_SELF_PIN')
    h.need(q.certifier_bundle()['certifierSha256']==h.pin(a.certifier_sha256),'CLOSURE_CERTIFIER_PIN')
    certifier=q.Certifier()
    with h.locked(certifier.cfg):
        # One continuous dual-lock period through certificate, terminal fsync and close.
        certificate=certifier.certify_locked(a.coord_sha256,a.coord_record_sha256)
        coord=h.regular(certifier.cfg.coord);coordrec=h.describe(certifier.cfg.coord)
        h.need(h.H(coord)==certificate['coordBeforeSha256'] and coordrec==certificate['coordBeforeRecord'],'CLOSURE_OWN_COORD_CAS')
        state=h.decode(coord);window=state['window']
        h.need(state['shared_release_active'] is True and state['needsOperatorRecovery'] is True and window['status']=='recovery-required' and window['nonce']==certificate['nonce'] and window['owner_task']==certificate['ownerTask'],'CLOSURE_EXACT_FAILED_OWN_WINDOW')
        certifier.reference.private(NEW_STAGE)
        h.need(not RECOVERY.exists() and not RECOVERY.is_symlink(),'PERMANENT_RECOVERY_CLOSE_NO_REPLAY')
        RECOVERY.mkdir(mode=0o700);h.fsync_dir(NEW_STAGE)
        certificate_bytes=h.encode(certificate);certificate_path=RECOVERY/'certificate.json'
        h.exclusive(certificate_path,certificate_bytes,0o600);cert_record=h.describe(certificate_path)
        closed=copy.deepcopy(window)
        closed.update(status='closed',outcome='restored-original-baseline-verified',needsOperatorRecovery=False,closedAtUtc=h.now(),recoveryOwnerTask=OWNER,recoveryReceipt=str(RECOVERY/'confirmed.json'),recoveryCertificateSha256=h.H(certificate_bytes),deploymentBusinessAcceptanceVerified=False,originalStagePermanentNoReplay=True)
        closed['rollback']={'status':'owned-bytes-process-listener-source-rollback-certified','certificateSha256':h.H(certificate_bytes),'originalFailureReceiptSha256':certificate['originalFailureSha256'],'businessAcceptanceVerified':False}
        complete=copy.deepcopy(state)
        complete.update(window=closed,shared_release_active=False,needsOperatorRecovery=False,updated_at=h.now())
        complete.setdefault('window_history',[]).extend([copy.deepcopy(window),copy.deepcopy(closed)])
        closed_bytes=h.encode(complete)
        terminal={'schema':'front-fast-recovery-close-v1','status':'restored-recovery-verified','recoveryOwnerTask':OWNER,'originalOwnerTask':certificate['ownerTask'],'originalScope':certificate['scope'],'nonce':certificate['nonce'],'certificateSha256':h.H(certificate_bytes),'closedCoordSha256':h.H(closed_bytes),'coordBeforeSha256':h.H(coord),'wrapperSha256':h.H(wrapper),'certifierSha256':a.certifier_sha256,'fullMetaSha256':certificate['freshFullMetaSha256'],'allFourBeforeBytesExact':True,'sourceEntriesCount':certificate['entriesCount'],'otherSixRawExact':True,'ownStableConfigEnvPermissionsExact':True,'businessAcceptanceVerified':False,'businessDatabaseWrites':0,'activeFileWrites':0,'reloads':0,'originalStagePermanentNoReplay':True,'validOnlyWithExactClosedCoordAndNoFailure':True}
        terminal_path=RECOVERY/'confirmed.json';terminal_bytes=h.encode(terminal)
        h.exclusive(terminal_path,terminal_bytes,0o600);terminal_record=h.describe(terminal_path)
        # Unified audited last gate: all evidence pins, full inventory/env/processes,
        # source/store lock/TTL and coord bytes+metadata AFTER durable terminal fsync.
        q.assert_certificate_current(certifier,certificate,coord)
        h.need(h.regular(certificate_path)==certificate_bytes and h.describe(certificate_path)==cert_record and h.regular(terminal_path)==terminal_bytes and h.describe(terminal_path)==terminal_record,'CLOSURE_DURABLE_RECEIPT_CAS')
        h.need(h.regular(wrapper_path)==wrapper and q.certifier_bundle()['certifierSha256']==a.certifier_sha256,'CLOSURE_FINAL_SOURCE_PINS')
        h.need(not (RECOVERY/'failure.json').exists() and not (RECOVERY/'failure.json').is_symlink(),'CLOSURE_FAILURE_OVERRIDE')
        h.need(h.regular(certifier.cfg.coord)==coord and h.describe(certifier.cfg.coord)==coordrec,'CLOSURE_FINAL_COORD_CAS')
        close_cas(certifier.cfg,coord,coordrec,closed_bytes,terminal_path,terminal_bytes,terminal_record)
        sys.stdout.buffer.write(h.encode(dict(terminal,coordinationClosed=True,receiptPath=str(terminal_path))))
if __name__=='__main__':
    try:main()
    except BaseException as exc:
        print('RECOVERY_CLOSE_STOPPED '+(str(exc) if isinstance(exc,h.ReleaseError) else type(exc).__name__),file=sys.stderr)
        sys.exit(1)
